import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import {
  buildFollowupUserPromptFromData,
  FOLLOWUP_CONFIG,
  FOLLOWUP_SYSTEM_PROMPT,
  validateFollowupPlan,
} from './agentLogic/followup'
import {
  buildReminderUserPromptFromData,
  DEFAULT_REMINDER_SETTINGS,
  REMINDER_CONFIG,
  REMINDER_SYSTEM_PROMPT,
  type ReminderAgentSettings,
  validateReminderPlan,
} from './agentLogic/reminder'
import { assessAction } from './agentLogic/risk'
import { callLLM, resolveLLMProvider } from './llmProvider'

const ORG_EXECUTION_BATCH_SIZE = 10
const MIN_REMINDER_WINDOW_HOURS = 1
const MAX_REMINDER_WINDOW_HOURS = 168
const MIN_REMINDER_BATCH_SIZE = 1
const MAX_REMINDER_BATCH_SIZE = 100

type PlannedAction = {
  type: string
  target: string
  params: Record<string, unknown>
  riskLevel: 'low' | 'medium' | 'high'
  reasoning: string
}

type RejectedAction = {
  type: string
  target: string
  reason: string
}

type ApprovedAction = {
  type: string
  target: string
  params: Record<string, unknown>
  riskLevel: 'low' | 'medium' | 'high'
  reasoning: string
}

type ReviewedActions = {
  approved: ApprovedAction[]
  rejectedByPolicy: RejectedAction[]
  rejectedForApproval: RejectedAction[]
}

type ExecutionOutcome = {
  status: 'completed' | 'awaiting_approval' | 'failed'
  error?: string
}

export function determineExecutionOutcome({
  failureCount,
  rejectedForApprovalCount,
}: {
  failureCount: number
  rejectedForApprovalCount: number
}): ExecutionOutcome {
  if (failureCount > 0) {
    return {
      status: 'failed',
      error: `${failureCount} action(s) failed during execution`,
    }
  }

  if (rejectedForApprovalCount > 0) {
    return { status: 'awaiting_approval' }
  }

  return { status: 'completed' }
}

export function sanitizeReminderSettings(raw: unknown): ReminderAgentSettings {
  const fallback = DEFAULT_REMINDER_SETTINGS

  if (!raw || typeof raw !== 'object') {
    return fallback
  }

  const settings = raw as Record<string, unknown>
  const reminderWindowHours = Array.isArray(settings.reminderWindowHours)
    ? settings.reminderWindowHours
        .map((value) => Number(value))
        .filter(
          (value) =>
            Number.isFinite(value) &&
            value >= MIN_REMINDER_WINDOW_HOURS &&
            value <= MAX_REMINDER_WINDOW_HOURS
        )
    : []

  const uniqueWindows = [...new Set(reminderWindowHours)].sort((a, b) => a - b)
  const maxAppointmentsPerBatch = Number(settings.maxAppointmentsPerBatch)

  return {
    reminderWindowHours:
      uniqueWindows.length > 0 ? uniqueWindows : [...fallback.reminderWindowHours],
    maxAppointmentsPerBatch:
      Number.isFinite(maxAppointmentsPerBatch) &&
      maxAppointmentsPerBatch >= MIN_REMINDER_BATCH_SIZE &&
      maxAppointmentsPerBatch <= MAX_REMINDER_BATCH_SIZE
        ? Math.floor(maxAppointmentsPerBatch)
        : fallback.maxAppointmentsPerBatch,
  }
}

export function reviewPlannedActions(
  actions: PlannedAction[],
  guardrails: {
    allowedActions: string[]
    maxActionsPerRun: number
    riskOverrides: Record<string, 'low' | 'medium' | 'high'>
    requireApprovalAbove: 'low' | 'medium' | 'high'
  },
  agentType: 'followup' | 'reminder'
): ReviewedActions {
  const approved: ApprovedAction[] = []
  const rejectedByPolicy: RejectedAction[] = []
  const rejectedForApproval: RejectedAction[] = []
  const boundedActions = actions.slice(0, guardrails.maxActionsPerRun)
  const reminderDedupeKeys = new Set<string>()

  for (const action of boundedActions) {
    if (!guardrails.allowedActions.includes(action.type)) {
      rejectedByPolicy.push({
        type: action.type,
        target: action.target,
        reason: 'Action not in allowed list',
      })
      continue
    }

    if (agentType === 'reminder') {
      const dedupeKey = `${action.type}:${action.target}`
      if (reminderDedupeKeys.has(dedupeKey)) {
        rejectedByPolicy.push({
          type: action.type,
          target: action.target,
          reason: 'Duplicate reminder action for the same target',
        })
        continue
      }
      reminderDedupeKeys.add(dedupeKey)
    }

    const assessment = assessAction(action, guardrails)
    if (!assessment.approved) {
      rejectedForApproval.push({
        type: action.type,
        target: action.target,
        reason: assessment.reason ?? `Risk level '${assessment.assessedRisk}' requires approval`,
      })
      continue
    }

    approved.push({
      type: action.type,
      target: action.target,
      params: action.params,
      riskLevel: assessment.assessedRisk,
      reasoning: action.reasoning,
    })
  }

  return { approved, rejectedByPolicy, rejectedForApproval }
}

type AgentBatchCounters = {
  processed: number
  skipped: number
  failed: number
  awaitingApproval: number
}

async function runAgentBatch(
  ctx: { runQuery: any; runAction: any },
  agentType: 'followup' | 'reminder'
): Promise<AgentBatchCounters> {
  const enabledDefs: Doc<'agentDefinitions'>[] = await ctx.runQuery(
    internal.agentDefinitions.listEnabledByType,
    { agentType }
  )

  if (enabledDefs.length === 0) {
    console.log(`[AgentRunner] No enabled ${agentType} agents found`)
    return { processed: 0, skipped: 0, failed: 0, awaitingApproval: 0 }
  }

  const counters: AgentBatchCounters = { processed: 0, skipped: 0, failed: 0, awaitingApproval: 0 }

  for (let i = 0; i < enabledDefs.length; i += ORG_EXECUTION_BATCH_SIZE) {
    const batch = enabledDefs.slice(i, i + ORG_EXECUTION_BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map((def) =>
        ctx.runAction(internal.agentRunner.runAgentForOrg, {
          organizationId: def.organizationId,
          agentType,
          triggerType: 'cron',
          reminderSettings:
            agentType === 'reminder' ? sanitizeReminderSettings(def.settings) : undefined,
        })
      )
    )

    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        const runStatus = result.value.status
        if (runStatus === 'completed') counters.processed++
        else if (runStatus === 'skipped') counters.skipped++
        else if (runStatus === 'awaiting_approval') counters.awaitingApproval++
        else counters.failed++
        continue
      }

      const def = batch[index]
      counters.failed++
      console.error(`[AgentRunner] ${agentType} failed for org:`, {
        organizationId: String(def.organizationId),
        error: result.reason instanceof Error ? result.reason.message : 'Unknown',
      })
    }
  }

  return counters
}

export const runFollowupAgent = internalAction({
  args: {},
  handler: async (ctx) => runAgentBatch(ctx, 'followup'),
})

export const runReminderAgent = internalAction({
  args: {},
  handler: async (ctx) => runAgentBatch(ctx, 'reminder'),
})

/**
 * Run a specific agent for a specific organization.
 * This is the main execution entry point.
 */
export const runAgentForOrg = internalAction({
  args: {
    organizationId: v.id('organizations'),
    agentType: v.union(v.literal('followup'), v.literal('reminder')),
    triggerType: v.string(),
    triggerId: v.optional(v.string()),
    reminderSettings: v.optional(
      v.object({
        reminderWindowHours: v.array(v.number()),
        maxAppointmentsPerBatch: v.number(),
      })
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    status: 'completed' | 'awaiting_approval' | 'skipped' | 'failed'
    reason?: string
    error?: string
    executionId?: Id<'agentExecutions'>
    actionsPlanned?: number
    actionsExecuted?: number
    actionsSkipped?: number
    actionsRejectedForApproval?: number
  }> => {
    const executionStart: {
      skipped: boolean
      reason: 'already_running' | null
      executionId: Id<'agentExecutions'>
    } = await ctx.runMutation(internal.agentExecutions.createIfNotRunning, {
      organizationId: args.organizationId,
      agentType: args.agentType,
      triggerType: args.triggerType,
      triggerId: args.triggerId,
    })

    if (executionStart.skipped) {
      return {
        status: 'skipped',
        reason: 'Agent execution already in progress',
        executionId: executionStart.executionId,
      }
    }

    const executionId: Id<'agentExecutions'> = executionStart.executionId

    try {
      await ctx.runMutation(internal.agentExecutions.updateStatus, {
        id: executionId,
        status: 'loading_context',
      })

      let plan: {
        actions: Array<{
          type: string
          target: string
          params: Record<string, unknown>
          riskLevel: 'low' | 'medium' | 'high'
          reasoning: string
        }>
        summary: string
        reasoning: string
      }
      let agentConfig: typeof FOLLOWUP_CONFIG

      if (args.agentType === 'reminder') {
        const reminderSettings = sanitizeReminderSettings(args.reminderSettings)
        const maxWindowHours = Math.max(...reminderSettings.reminderWindowHours)
        const upcomingAppointments = await ctx.runQuery(
          internal.agentRunner.getUpcomingAppointmentsForReminder,
          {
            organizationId: args.organizationId,
            windowHours: maxWindowHours,
            maxAppointments: reminderSettings.maxAppointmentsPerBatch,
            now: Date.now(),
          }
        )

        if (upcomingAppointments.length === 0) {
          await ctx.runMutation(internal.agentExecutions.complete, {
            id: executionId,
            status: 'skipped',
            actionsPlanned: 0,
            actionsExecuted: 0,
            actionsSkipped: 0,
          })
          return { status: 'skipped', reason: 'No upcoming appointments needing reminders' }
        }

        const leadIds = [...new Set(upcomingAppointments.map((a) => a.leadId))]
        const [leads, agentMemories, businessMemories] = await Promise.all([
          ctx.runQuery(internal.agentRunner.getLeadsByIds, {
            organizationId: args.organizationId,
            leadIds,
          }),
          ctx.runQuery(internal.agentRunner.getAgentMemories, {
            organizationId: args.organizationId,
            agentType: 'reminder',
            limit: 15,
          }),
          ctx.runQuery(internal.agentRunner.getBusinessContext, {
            organizationId: args.organizationId,
            limit: 20,
          }),
        ])

        await ctx.runMutation(internal.agentExecutions.updateStatus, {
          id: executionId,
          status: 'planning',
          memoryContext: JSON.stringify({
            appointmentsCount: upcomingAppointments.length,
            leadsCount: leads.length,
            memoriesCount: agentMemories.length + businessMemories.length,
            reminderSettings,
          }),
        })

        const userPrompt = buildReminderUserPromptFromData(
          upcomingAppointments,
          leads,
          agentMemories,
          businessMemories,
          reminderSettings.reminderWindowHours
        )

        const provider = resolveLLMProvider()
        const rawPlan = await callLLM(provider, REMINDER_SYSTEM_PROMPT, userPrompt, 0.1, 2500)
        plan = validateReminderPlan(rawPlan)
        agentConfig = REMINDER_CONFIG
      } else {
        const leads = await ctx.runQuery(internal.agentRunner.getStaleLeads, {
          organizationId: args.organizationId,
          staleDaysThreshold: 3,
          targetStatuses: ['Contacted', 'Qualified', 'Proposal'],
          maxLeads: 20,
          now: Date.now(),
        })

        if (leads.length === 0) {
          await ctx.runMutation(internal.agentExecutions.complete, {
            id: executionId,
            status: 'skipped',
            actionsPlanned: 0,
            actionsExecuted: 0,
            actionsSkipped: 0,
          })
          return { status: 'skipped', reason: 'No stale leads found' }
        }

        const [appointments, agentMemories, businessMemories] = await Promise.all([
          ctx.runQuery(internal.agentRunner.getRecentAppointments, {
            organizationId: args.organizationId,
            limit: 10,
          }),
          ctx.runQuery(internal.agentRunner.getAgentMemories, {
            organizationId: args.organizationId,
            agentType: args.agentType,
            limit: 15,
          }),
          ctx.runQuery(internal.agentRunner.getBusinessContext, {
            organizationId: args.organizationId,
            limit: 20,
          }),
        ])

        await ctx.runMutation(internal.agentExecutions.updateStatus, {
          id: executionId,
          status: 'planning',
          memoryContext: JSON.stringify({
            leadsCount: leads.length,
            appointmentsCount: appointments.length,
            memoriesCount: agentMemories.length + businessMemories.length,
          }),
        })

        const userPrompt = buildFollowupUserPromptFromData(
          leads,
          appointments,
          agentMemories,
          businessMemories
        )

        const provider = resolveLLMProvider()
        const rawPlan = await callLLM(provider, FOLLOWUP_SYSTEM_PROMPT, userPrompt, 0.1, 2500)
        plan = validateFollowupPlan(rawPlan)
        agentConfig = FOLLOWUP_CONFIG
      }

      await ctx.runMutation(internal.agentExecutions.updateStatus, {
        id: executionId,
        status: 'risk_assessing',
        plan: plan,
      })

      const reviewedActions = reviewPlannedActions(
        plan.actions,
        agentConfig.guardrails,
        args.agentType
      )
      const skippedByPolicy = reviewedActions.rejectedByPolicy.length
      const rejectedForApproval = reviewedActions.rejectedForApproval.length

      await ctx.runMutation(internal.agentExecutions.updateStatus, {
        id: executionId,
        status: 'executing',
      })

      let executed = 0
      let skippedInExecution = 0
      const results: Array<{ type: string; target: string; success: boolean; message: string }> = []

      for (const action of reviewedActions.approved) {
        try {
          if (action.type === 'update_lead_notes') {
            const notesText = String(action.params?.notes ?? '').trim()
            if (!notesText) {
              results.push({
                type: action.type,
                target: action.target,
                success: true,
                message: 'Skipped: empty notes',
              })
              skippedInExecution++
              continue
            }
            await ctx.runMutation(internal.agentRunner.updateLeadNotes, {
              organizationId: args.organizationId,
              leadId: action.target as Id<'leads'>,
              notes: notesText,
              agentType: args.agentType,
            })
            results.push({
              type: action.type,
              target: action.target,
              success: true,
              message: 'Notes updated',
            })
          } else if (action.type === 'update_lead_status') {
            await ctx.runMutation(internal.agentRunner.updateLeadStatus, {
              organizationId: args.organizationId,
              leadId: action.target as Id<'leads'>,
              status: String(action.params?.status ?? ''),
            })
            results.push({
              type: action.type,
              target: action.target,
              success: true,
              message: `Status updated to ${action.params?.status}`,
            })
          } else if (action.type === 'update_appointment_notes') {
            const apptNotes = String(action.params?.notes ?? '').trim()
            if (!apptNotes) {
              results.push({
                type: action.type,
                target: action.target,
                success: true,
                message: 'Skipped: empty notes',
              })
              skippedInExecution++
              continue
            }
            await ctx.runMutation(internal.agentRunner.updateAppointmentNotes, {
              organizationId: args.organizationId,
              appointmentId: action.target as Id<'appointments'>,
              notes: apptNotes,
            })
            results.push({
              type: action.type,
              target: action.target,
              success: true,
              message: 'Reminder note added to appointment',
            })
          } else if (
            action.type === 'log_recommendation' ||
            action.type === 'log_reminder_recommendation'
          ) {
            results.push({
              type: action.type,
              target: action.target,
              success: true,
              message: String(action.params?.recommendation ?? ''),
            })
          } else {
            results.push({
              type: action.type,
              target: action.target,
              success: true,
              message: 'Skipped: unsupported action type',
            })
            skippedInExecution++
            continue
          }
          executed++
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown'
          results.push({ type: action.type, target: action.target, success: false, message })
        }
      }

      const successes = results.filter((r) => r.success)
      const failures = results.filter((r) => !r.success)

      if (successes.length > 0) {
        const label = args.agentType === 'reminder' ? 'reminder' : 'followup'
        await ctx.runMutation(internal.agentRunner.recordAgentLearning, {
          organizationId: args.organizationId,
          agentType: args.agentType,
          category: 'success',
          content: `Executed ${successes.length} ${label} actions.`,
          confidence: 0.8,
        })
      }

      if (failures.length > 0) {
        const label = args.agentType === 'reminder' ? 'reminder' : 'followup'
        const errorSummary = failures.map((f) => `${f.type}: ${f.message}`).join('; ')
        await ctx.runMutation(internal.agentRunner.recordAgentLearning, {
          organizationId: args.organizationId,
          agentType: args.agentType,
          category: 'failure',
          content: `Failed ${failures.length} ${label} actions: ${errorSummary}`,
          confidence: 0.6,
        })
      }

      const actionsSkipped = skippedByPolicy + skippedInExecution
      const executionOutcome = determineExecutionOutcome({
        failureCount: failures.length,
        rejectedForApprovalCount: rejectedForApproval,
      })

      await ctx.runMutation(internal.agentExecutions.complete, {
        id: executionId,
        status: executionOutcome.status,
        results,
        actionsPlanned: plan.actions.length,
        actionsExecuted: executed,
        actionsSkipped,
        error: executionOutcome.error,
      })

      return {
        status: executionOutcome.status,
        error: executionOutcome.error,
        actionsPlanned: plan.actions.length,
        actionsExecuted: executed,
        actionsSkipped,
        actionsRejectedForApproval: rejectedForApproval,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      await ctx.runMutation(internal.agentExecutions.fail, {
        id: executionId,
        error: message,
      })
      console.error('[AgentRunner] Execution failed:', {
        organizationId: String(args.organizationId),
        agentType: args.agentType,
        error: message,
      })
      return { status: 'failed', error: message }
    }
  },
})

// ── Internal helpers (queries/mutations callable only within Convex) ──

const MS_PER_DAY = 86_400_000

export const getStaleLeads = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    staleDaysThreshold: v.number(),
    targetStatuses: v.array(v.string()),
    maxLeads: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const now = args.now
    const cutoff = now - args.staleDaysThreshold * MS_PER_DAY

    const perStatusCap = args.maxLeads * 3

    const leadsByStatus = await Promise.all(
      args.targetStatuses.map((status) =>
        ctx.db
          .query('leads')
          .withIndex('by_org_status', (q) =>
            q
              .eq('organizationId', args.organizationId)
              .eq(
                'status',
                status as 'New' | 'Contacted' | 'Qualified' | 'Proposal' | 'Booked' | 'Closed'
              )
          )
          .take(perStatusCap)
      )
    )

    return leadsByStatus
      .flat()
      .filter((lead) => {
        const lastContact = lead.lastContact ?? lead.createdAt
        return lastContact < cutoff
      })
      .sort((a, b) => (a.lastContact ?? a.createdAt) - (b.lastContact ?? b.createdAt))
      .slice(0, args.maxLeads)
      .map((lead) => ({
        id: lead._id,
        name: lead.name,
        status: lead.status,
        phone: lead.phone,
        email: lead.email,
        value: lead.value,
        tags: lead.tags,
        notes: lead.notes,
        lastContact: lead.lastContact ?? lead.createdAt,
        daysSinceContact: Math.floor((now - (lead.lastContact ?? lead.createdAt)) / MS_PER_DAY),
      }))
  },
})

export const getRecentAppointments = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const appointments = await ctx.db
      .query('appointments')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')
      .take(args.limit)

    return appointments.map((a) => ({
      id: a._id,
      leadName: a.leadName,
      date: a.date,
      time: a.time,
      title: a.title,
      status: a.status,
    }))
  },
})

export const getAgentMemories = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    agentType: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const memories = await ctx.db
      .query('agentMemories')
      .withIndex('by_org_agent_active', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentType', args.agentType)
          .eq('isActive', true)
      )
      .order('desc')
      .take(args.limit)

    return memories.map((m) => ({
      category: m.category,
      content: m.content,
      confidence: m.confidence,
      successRate: m.successRate,
    }))
  },
})

export const getBusinessContext = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const memories = await ctx.db
      .query('businessMemories')
      .withIndex('by_org_active', (q) =>
        q.eq('organizationId', args.organizationId).eq('isActive', true)
      )
      .order('desc')
      .take(args.limit)

    return memories.map((m) => ({
      type: m.type,
      content: m.content,
      confidence: m.confidence,
    }))
  },
})

export const updateLeadNotes = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    leadId: v.id('leads'),
    notes: v.string(),
    agentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId)
    if (!lead) throw new Error(`Lead not found: ${args.leadId}`)
    if (lead.organizationId !== args.organizationId) {
      throw new Error('Lead does not belong to this organization')
    }

    const noteText = args.notes.trim()
    if (!noteText) return

    const existingNotes = lead.notes ?? ''
    const timestamp = new Date().toISOString().split('T')[0]
    const label = args.agentType === 'reminder' ? 'Reminder' : 'Agent'
    if (label === 'Reminder' && existingNotes.includes(`[Reminder ${timestamp}]`)) {
      return
    }
    const updatedNotes = existingNotes
      ? `${existingNotes}\n[${label} ${timestamp}] ${noteText}`
      : `[${label} ${timestamp}] ${noteText}`

    await ctx.db.patch(args.leadId, {
      notes: updatedNotes,
      lastContact: Date.now(),
      updatedAt: Date.now(),
    })
  },
})

export const updateLeadStatus = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    leadId: v.id('leads'),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId)
    if (!lead) throw new Error(`Lead not found: ${args.leadId}`)
    if (lead.organizationId !== args.organizationId) {
      throw new Error('Lead does not belong to this organization')
    }

    const validStatuses = ['New', 'Contacted', 'Qualified', 'Proposal', 'Booked', 'Closed']
    if (!validStatuses.includes(args.status)) {
      throw new Error(`Invalid status: ${args.status}`)
    }

    await ctx.db.patch(args.leadId, {
      status: args.status as 'New' | 'Contacted' | 'Qualified' | 'Proposal' | 'Booked' | 'Closed',
      updatedAt: Date.now(),
    })
  },
})

// ── Reminder-specific helpers ─────────────────────────────────────────
// NOTE: All date/time comparisons use UTC. Appointment dates are stored as
// YYYY-MM-DD strings and times as HH:MM. The cron runs at 09:00 UTC.
// hoursUntil is computed by parsing "{date}T{time}:00" as UTC.

const MS_PER_HOUR = 3_600_000

interface ReminderAppointmentDoc {
  _id: Id<'appointments'> | string
  leadId: Id<'leads'> | string
  leadName: string
  date: string
  time: string
  title?: string
  notes?: string
  status: string
}

interface ReminderAppointmentCandidate {
  id: string
  leadId: string
  leadName: string
  date: string
  time: string
  title?: string
  notes?: string
  status: string
  hoursUntil: number
  appointmentTime: number
}

function toAppointmentTimestampUtc(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00Z`)
}

export function selectReminderCandidates(
  appointments: ReminderAppointmentDoc[],
  now: number,
  windowEnd: number
): ReminderAppointmentCandidate[] {
  return appointments
    .filter((appointment) => {
      if (appointment.status !== 'scheduled') return false
      if (appointment.notes?.includes('[Reminder')) return false

      const appointmentTime = toAppointmentTimestampUtc(appointment.date, appointment.time)
      if (Number.isNaN(appointmentTime)) return false
      if (appointmentTime <= now || appointmentTime > windowEnd) return false
      return true
    })
    .map((appointment) => {
      const appointmentTime = toAppointmentTimestampUtc(appointment.date, appointment.time)
      const rawHours = Math.round((appointmentTime - now) / MS_PER_HOUR)
      return {
        id: String(appointment._id),
        leadId: String(appointment.leadId),
        leadName: appointment.leadName,
        date: appointment.date,
        time: appointment.time,
        title: appointment.title,
        notes: appointment.notes,
        status: appointment.status,
        hoursUntil: Number.isNaN(rawHours) ? 0 : Math.max(0, rawHours),
        appointmentTime,
      }
    })
}

export const getUpcomingAppointmentsForReminder = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    windowHours: v.number(),
    maxAppointments: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const now = args.now
    const windowEnd = now + args.windowHours * MS_PER_HOUR

    const today = new Date(now).toISOString().split('T')[0]
    const windowEndDate = new Date(windowEnd).toISOString().split('T')[0]

    const pageSize = Math.max(args.maxAppointments * 3, 50)
    const maxBuffer = Math.max(args.maxAppointments * 10, 200)
    const candidates: ReminderAppointmentCandidate[] = []
    let cursor: string | null = null
    let done = false

    while (!done) {
      const page = await ctx.db
        .query('appointments')
        .withIndex('by_org_date', (q) =>
          q.eq('organizationId', args.organizationId).gte('date', today).lte('date', windowEndDate)
        )
        .order('asc')
        .paginate({ numItems: pageSize, cursor })

      const pageCandidates = selectReminderCandidates(
        page.page as ReminderAppointmentDoc[],
        now,
        windowEnd
      )
      candidates.push(...pageCandidates)

      if (candidates.length > maxBuffer) {
        candidates.sort((left, right) => left.appointmentTime - right.appointmentTime)
        candidates.splice(maxBuffer)
      }

      done = page.isDone
      cursor = page.continueCursor
    }

    return candidates
      .sort((left, right) => left.appointmentTime - right.appointmentTime)
      .slice(0, args.maxAppointments)
      .map(({ appointmentTime: _appointmentTime, ...appointment }) => appointment)
  },
})

export const getLeadsByIds = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    leadIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const results: Array<{
      id: string
      name: string
      phone?: string
      email?: string
      notes?: string
    }> = []

    for (const leadIdStr of args.leadIds) {
      const lead = await ctx.db.get(leadIdStr as Id<'leads'>)
      if (!lead || lead.organizationId !== args.organizationId) continue
      results.push({
        id: String(lead._id),
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        notes: lead.notes,
      })
    }

    return results
  },
})

export const updateAppointmentNotes = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    appointmentId: v.id('appointments'),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get(args.appointmentId)
    if (!appointment) throw new Error(`Appointment not found: ${args.appointmentId}`)
    if (appointment.organizationId !== args.organizationId) {
      throw new Error('Appointment does not belong to this organization')
    }

    const timestamp = new Date().toISOString().split('T')[0]
    const reminderText = args.notes.trim()
    if (!reminderText) return

    const existingNotes = appointment.notes ?? ''
    if (existingNotes.includes(`[Reminder ${timestamp}]`)) {
      return
    }
    const updatedNotes = existingNotes
      ? `${existingNotes}\n[Reminder ${timestamp}] ${reminderText}`
      : `[Reminder ${timestamp}] ${reminderText}`

    await ctx.db.patch(args.appointmentId, {
      notes: updatedNotes,
      updatedAt: Date.now(),
    })
  },
})

const LEARNING_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000

export const recordAgentLearning = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    agentType: v.string(),
    category: v.union(
      v.literal('pattern'),
      v.literal('preference'),
      v.literal('success'),
      v.literal('failure')
    ),
    content: v.string(),
    confidence: v.float64(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const cutoff = now - LEARNING_DEDUP_WINDOW_MS

    const recentSimilar = await ctx.db
      .query('agentMemories')
      .withIndex('by_org_agent_active', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentType', args.agentType)
          .eq('isActive', true)
      )
      .order('desc')
      .take(10)

    const duplicate = recentSimilar.find(
      (m) => m.category === args.category && m.createdAt > cutoff
    )

    if (duplicate) {
      await ctx.db.patch(duplicate._id, {
        content: args.content,
        confidence: Math.max(duplicate.confidence, args.confidence),
        useCount: duplicate.useCount + 1,
        lastUsedAt: now,
        updatedAt: now,
      })
      return duplicate._id
    }

    return await ctx.db.insert('agentMemories', {
      organizationId: args.organizationId,
      agentType: args.agentType,
      category: args.category,
      content: args.content,
      confidence: args.confidence,
      useCount: 0,
      successRate: args.category === 'success' ? 1.0 : args.category === 'failure' ? 0.0 : 0.5,
      decayScore: 1.0,
      lastUsedAt: now,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
  },
})

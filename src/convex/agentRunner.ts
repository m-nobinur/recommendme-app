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
  buildInvoiceUserPromptFromData,
  DEFAULT_INVOICE_SETTINGS,
  INVOICE_CONFIG,
  INVOICE_SYSTEM_PROMPT,
  type InvoiceAgentSettings,
  validateInvoicePlan,
} from './agentLogic/invoice'
import {
  buildReminderUserPromptFromData,
  DEFAULT_REMINDER_SETTINGS,
  REMINDER_CONFIG,
  REMINDER_SYSTEM_PROMPT,
  type ReminderAgentSettings,
  validateReminderPlan,
} from './agentLogic/reminder'
import { assessAction } from './agentLogic/risk'
import {
  buildSalesUserPromptFromData,
  DEFAULT_SALES_SETTINGS,
  SALES_CONFIG,
  SALES_SYSTEM_PROMPT,
  type SalesAgentSettings,
  validateSalesPlan,
} from './agentLogic/sales'
import { isCronDisabled } from './lib/cronGuard'
import {
  appointmentToEpoch,
  epochToDateInTimezone,
  resolveTimezone,
  todayInTimezone,
} from './lib/timezone'
import { callLLM, resolveLLMProvider } from './llmProvider'

const ORG_EXECUTION_BATCH_SIZE = 10
const MIN_REMINDER_WINDOW_HOURS = 1
const MAX_REMINDER_WINDOW_HOURS = 168
const MIN_REMINDER_BATCH_SIZE = 1
const MAX_REMINDER_BATCH_SIZE = 100
const MIN_INVOICE_PAYMENT_TERMS_DAYS = 1
const MAX_INVOICE_PAYMENT_TERMS_DAYS = 120
const MIN_INVOICE_OVERDUE_THRESHOLD_DAYS = 1
const MAX_INVOICE_OVERDUE_THRESHOLD_DAYS = 90
const MIN_INVOICE_BATCH_SIZE = 1
const MAX_INVOICE_BATCH_SIZE = 100
const MIN_SALES_STALE_THRESHOLD_DAYS = 1
const MAX_SALES_STALE_THRESHOLD_DAYS = 90
const MIN_SALES_BATCH_SIZE = 1
const MAX_SALES_BATCH_SIZE = 200
const MIN_SALES_HIGH_VALUE = 0
const MAX_SALES_HIGH_VALUE = 1_000_000

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

export function sanitizeInvoiceSettings(raw: unknown): InvoiceAgentSettings {
  const fallback = DEFAULT_INVOICE_SETTINGS

  if (!raw || typeof raw !== 'object') {
    return fallback
  }

  const settings = raw as Record<string, unknown>
  const defaultPaymentTermsDays = Number(settings.defaultPaymentTermsDays)
  const overdueThresholdDays = Number(settings.overdueThresholdDays)
  const maxInvoicesPerBatch = Number(settings.maxInvoicesPerBatch)

  return {
    defaultPaymentTermsDays:
      Number.isFinite(defaultPaymentTermsDays) &&
      defaultPaymentTermsDays >= MIN_INVOICE_PAYMENT_TERMS_DAYS &&
      defaultPaymentTermsDays <= MAX_INVOICE_PAYMENT_TERMS_DAYS
        ? Math.floor(defaultPaymentTermsDays)
        : fallback.defaultPaymentTermsDays,
    overdueThresholdDays:
      Number.isFinite(overdueThresholdDays) &&
      overdueThresholdDays >= MIN_INVOICE_OVERDUE_THRESHOLD_DAYS &&
      overdueThresholdDays <= MAX_INVOICE_OVERDUE_THRESHOLD_DAYS
        ? Math.floor(overdueThresholdDays)
        : fallback.overdueThresholdDays,
    maxInvoicesPerBatch:
      Number.isFinite(maxInvoicesPerBatch) &&
      maxInvoicesPerBatch >= MIN_INVOICE_BATCH_SIZE &&
      maxInvoicesPerBatch <= MAX_INVOICE_BATCH_SIZE
        ? Math.floor(maxInvoicesPerBatch)
        : fallback.maxInvoicesPerBatch,
  }
}

export function sanitizeSalesSettings(raw: unknown): SalesAgentSettings {
  const fallback = DEFAULT_SALES_SETTINGS

  if (!raw || typeof raw !== 'object') {
    return fallback
  }

  const settings = raw as Record<string, unknown>
  const staleThresholdDays = Number(settings.staleThresholdDays)
  const maxLeadsPerBatch = Number(settings.maxLeadsPerBatch)
  const highValueThreshold = Number(settings.highValueThreshold)

  return {
    staleThresholdDays:
      Number.isFinite(staleThresholdDays) &&
      staleThresholdDays >= MIN_SALES_STALE_THRESHOLD_DAYS &&
      staleThresholdDays <= MAX_SALES_STALE_THRESHOLD_DAYS
        ? Math.floor(staleThresholdDays)
        : fallback.staleThresholdDays,
    maxLeadsPerBatch:
      Number.isFinite(maxLeadsPerBatch) &&
      maxLeadsPerBatch >= MIN_SALES_BATCH_SIZE &&
      maxLeadsPerBatch <= MAX_SALES_BATCH_SIZE
        ? Math.floor(maxLeadsPerBatch)
        : fallback.maxLeadsPerBatch,
    highValueThreshold:
      Number.isFinite(highValueThreshold) &&
      highValueThreshold >= MIN_SALES_HIGH_VALUE &&
      highValueThreshold <= MAX_SALES_HIGH_VALUE
        ? highValueThreshold
        : fallback.highValueThreshold,
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
  agentType: 'followup' | 'reminder' | 'invoice' | 'sales'
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
  agentType: 'followup' | 'reminder' | 'invoice' | 'sales'
): Promise<AgentBatchCounters> {
  if (isCronDisabled()) {
    return { processed: 0, skipped: 0, failed: 0, awaitingApproval: 0 }
  }

  const enabledDefs: Doc<'agentDefinitions'>[] = await ctx.runQuery(
    internal.agentDefinitions.listEnabledByType,
    { agentType }
  )

  if (enabledDefs.length === 0) {
    console.log(`[AgentRunner] No enabled ${agentType} agents found`)
    return { processed: 0, skipped: 0, failed: 0, awaitingApproval: 0 }
  }

  const counters: AgentBatchCounters = { processed: 0, skipped: 0, failed: 0, awaitingApproval: 0 }

  const orgIds = [...new Set(enabledDefs.map((d) => d.organizationId))]
  const orgs = await Promise.all(
    orgIds.map((id) => ctx.runQuery(internal.agentRunner.getOrgTimezone, { organizationId: id }))
  )
  const orgTimezoneMap = new Map<string, string>()
  for (let i = 0; i < orgIds.length; i++) {
    orgTimezoneMap.set(String(orgIds[i]), resolveTimezone(orgs[i]))
  }

  for (let i = 0; i < enabledDefs.length; i += ORG_EXECUTION_BATCH_SIZE) {
    const batch = enabledDefs.slice(i, i + ORG_EXECUTION_BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map((def) =>
        ctx.runAction(internal.agentRunner.runAgentForOrg, {
          organizationId: def.organizationId,
          agentType,
          triggerType: 'cron',
          timezone: orgTimezoneMap.get(String(def.organizationId)) ?? 'UTC',
          reminderSettings:
            agentType === 'reminder' ? sanitizeReminderSettings(def.settings) : undefined,
          invoiceSettings:
            agentType === 'invoice' ? sanitizeInvoiceSettings(def.settings) : undefined,
          salesSettings: agentType === 'sales' ? sanitizeSalesSettings(def.settings) : undefined,
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

export const runInvoiceAgent = internalAction({
  args: {},
  handler: async (ctx) => runAgentBatch(ctx, 'invoice'),
})

export const runSalesAgent = internalAction({
  args: {},
  handler: async (ctx) => runAgentBatch(ctx, 'sales'),
})

/**
 * Event-driven entry point: triggered when a lead status changes.
 * Runs the sales agent for the specific organization to re-score and evaluate pipeline.
 */
export const runSalesAgentForLead = internalAction({
  args: {
    organizationId: v.id('organizations'),
    leadId: v.id('leads'),
  },
  handler: async (ctx, args): Promise<void> => {
    if (isCronDisabled()) return

    const def: Doc<'agentDefinitions'> | null = await ctx.runQuery(
      internal.agentDefinitions.getEnabledByOrgAndType,
      {
        organizationId: args.organizationId,
        agentType: 'sales',
      }
    )

    if (!def) return

    const tz: string | null = await ctx.runQuery(internal.agentRunner.getOrgTimezone, {
      organizationId: args.organizationId,
    })

    await ctx.runAction(internal.agentRunner.runAgentForOrg, {
      organizationId: args.organizationId,
      agentType: 'sales' as const,
      triggerType: 'event',
      triggerId: String(args.leadId),
      timezone: resolveTimezone(tz),
      salesSettings: sanitizeSalesSettings(def.settings),
    })
  },
})

/**
 * Event-driven entry point: triggered when an appointment is marked as completed.
 * Runs the invoice agent for the specific organization to create a draft invoice.
 */
export const runInvoiceAgentForAppointment = internalAction({
  args: {
    organizationId: v.id('organizations'),
    appointmentId: v.id('appointments'),
  },
  handler: async (ctx, args): Promise<void> => {
    if (isCronDisabled()) return

    const def: Doc<'agentDefinitions'> | null = await ctx.runQuery(
      internal.agentDefinitions.getEnabledByOrgAndType,
      {
        organizationId: args.organizationId,
        agentType: 'invoice',
      }
    )

    if (!def) {
      return
    }

    const tz: string | null = await ctx.runQuery(internal.agentRunner.getOrgTimezone, {
      organizationId: args.organizationId,
    })

    await ctx.runAction(internal.agentRunner.runAgentForOrg, {
      organizationId: args.organizationId,
      agentType: 'invoice' as const,
      triggerType: 'event',
      triggerId: String(args.appointmentId),
      timezone: resolveTimezone(tz),
      invoiceSettings: sanitizeInvoiceSettings(def.settings),
    })
  },
})

/**
 * Run a specific agent for a specific organization.
 * This is the main execution entry point.
 */
export const runAgentForOrg = internalAction({
  args: {
    organizationId: v.id('organizations'),
    agentType: v.union(
      v.literal('followup'),
      v.literal('reminder'),
      v.literal('invoice'),
      v.literal('sales')
    ),
    triggerType: v.string(),
    triggerId: v.optional(v.string()),
    timezone: v.optional(v.string()),
    reminderSettings: v.optional(
      v.object({
        reminderWindowHours: v.array(v.number()),
        maxAppointmentsPerBatch: v.number(),
      })
    ),
    invoiceSettings: v.optional(
      v.object({
        defaultPaymentTermsDays: v.number(),
        overdueThresholdDays: v.number(),
        maxInvoicesPerBatch: v.number(),
      })
    ),
    salesSettings: v.optional(
      v.object({
        staleThresholdDays: v.number(),
        maxLeadsPerBatch: v.number(),
        highValueThreshold: v.number(),
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
        const tz = resolveTimezone(args.timezone)
        const reminderSettings = sanitizeReminderSettings(args.reminderSettings)
        const maxWindowHours = Math.max(...reminderSettings.reminderWindowHours)
        const upcomingAppointments = await ctx.runQuery(
          internal.agentRunner.getUpcomingAppointmentsForReminder,
          {
            organizationId: args.organizationId,
            windowHours: maxWindowHours,
            maxAppointments: reminderSettings.maxAppointmentsPerBatch,
            now: Date.now(),
            timezone: tz,
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

        const leadIds = [...new Set(upcomingAppointments.map((a: { leadId: string }) => a.leadId))]
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
      } else if (args.agentType === 'invoice') {
        const now = Date.now()
        const invoiceSettings = sanitizeInvoiceSettings(args.invoiceSettings)

        const [completedAppointments, overdueInvoices] = await Promise.all([
          ctx.runQuery(internal.invoices.getCompletedAppointmentsWithoutInvoice, {
            organizationId: args.organizationId,
            maxResults: invoiceSettings.maxInvoicesPerBatch,
          }),
          ctx.runQuery(internal.invoices.getOverdueInvoices, {
            organizationId: args.organizationId,
            now,
            overdueThresholdDays: invoiceSettings.overdueThresholdDays,
            maxResults: invoiceSettings.maxInvoicesPerBatch,
          }),
        ])

        if (completedAppointments.length === 0 && overdueInvoices.length === 0) {
          await ctx.runMutation(internal.agentExecutions.complete, {
            id: executionId,
            status: 'skipped',
            actionsPlanned: 0,
            actionsExecuted: 0,
            actionsSkipped: 0,
          })
          return {
            status: 'skipped',
            reason: 'No appointments needing invoices and no overdue invoices',
          }
        }

        const leadIds = [
          ...new Set([
            ...completedAppointments.map((a: { leadId: string }) => a.leadId),
            ...overdueInvoices.map((i: { leadId: string }) => i.leadId),
          ]),
        ]
        const [leads, agentMemories, businessMemories] = await Promise.all([
          ctx.runQuery(internal.agentRunner.getLeadsByIds, {
            organizationId: args.organizationId,
            leadIds,
          }),
          ctx.runQuery(internal.agentRunner.getAgentMemories, {
            organizationId: args.organizationId,
            agentType: 'invoice',
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
            completedAppointmentsCount: completedAppointments.length,
            overdueInvoicesCount: overdueInvoices.length,
            leadsCount: leads.length,
            memoriesCount: agentMemories.length + businessMemories.length,
          }),
        })

        const userPrompt = buildInvoiceUserPromptFromData(
          completedAppointments,
          overdueInvoices.map(
            (i: {
              id: string
              leadName: string
              amount: number
              status: string
              dueDate?: string
              daysSinceDue?: number
              createdAt: number
            }) => ({
              id: i.id,
              leadName: i.leadName,
              amount: i.amount,
              status: i.status as 'draft' | 'sent' | 'paid',
              dueDate: i.dueDate,
              daysSinceDue: i.daysSinceDue,
              createdAt: i.createdAt,
            })
          ),
          leads.map(
            (l: { id: string; name: string; phone?: string; email?: string; notes?: string }) => ({
              id: l.id,
              name: l.name,
              phone: l.phone,
              email: l.email,
              notes: l.notes,
            })
          ),
          agentMemories,
          businessMemories,
          invoiceSettings
        )

        const provider = resolveLLMProvider()
        const rawPlan = await callLLM(provider, INVOICE_SYSTEM_PROMPT, userPrompt, 0.1, 2500)
        plan = validateInvoicePlan(rawPlan)
        agentConfig = INVOICE_CONFIG
      } else if (args.agentType === 'sales') {
        const salesSettings = sanitizeSalesSettings(args.salesSettings)
        const now = Date.now()

        const allLeads = await ctx.runQuery(internal.agentRunner.getLeadsForSalesPipeline, {
          organizationId: args.organizationId,
          maxLeads: salesSettings.maxLeadsPerBatch,
          now,
        })

        if (allLeads.length === 0) {
          await ctx.runMutation(internal.agentExecutions.complete, {
            id: executionId,
            status: 'skipped',
            actionsPlanned: 0,
            actionsExecuted: 0,
            actionsSkipped: 0,
          })
          return { status: 'skipped', reason: 'No leads in pipeline' }
        }

        const leadIds = allLeads.map((l: { id: string }) => l.id)
        const [appointments, invoices, agentMemories, businessMemories] = await Promise.all([
          ctx.runQuery(internal.agentRunner.getAppointmentsForLeads, {
            organizationId: args.organizationId,
            leadIds,
            limit: salesSettings.maxLeadsPerBatch * 3,
          }),
          ctx.runQuery(internal.agentRunner.getInvoicesForLeads, {
            organizationId: args.organizationId,
            leadIds,
            limit: salesSettings.maxLeadsPerBatch * 3,
          }),
          ctx.runQuery(internal.agentRunner.getAgentMemories, {
            organizationId: args.organizationId,
            agentType: 'sales',
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
            leadsCount: allLeads.length,
            appointmentsCount: appointments.length,
            invoicesCount: invoices.length,
            memoriesCount: agentMemories.length + businessMemories.length,
            salesSettings,
          }),
        })

        const apptByLead = new Map<string, { total: number; completed: number }>()
        for (const a of appointments) {
          const cur = apptByLead.get(a.leadId) ?? { total: 0, completed: 0 }
          cur.total++
          if (a.status === 'completed') cur.completed++
          apptByLead.set(a.leadId, cur)
        }
        const invByLead = new Map<string, { total: number; paid: number; amount: number }>()
        for (const i of invoices) {
          const cur = invByLead.get(i.leadId) ?? { total: 0, paid: 0, amount: 0 }
          cur.total++
          cur.amount += i.amount
          if (i.status === 'paid') cur.paid++
          invByLead.set(i.leadId, cur)
        }

        const salesLeadData = allLeads.map((l) => {
          const appt = apptByLead.get(l.id) ?? { total: 0, completed: 0 }
          const inv = invByLead.get(l.id) ?? { total: 0, paid: 0, amount: 0 }
          return {
            id: l.id,
            name: l.name,
            status: l.status,
            phone: l.phone,
            email: l.email,
            value: l.value,
            tags: l.tags ?? [],
            notes: l.notes,
            daysSinceUpdate: l.daysSinceContact,
            appointmentCount: appt.total,
            completedAppointmentCount: appt.completed,
            invoiceCount: inv.total,
            paidInvoiceCount: inv.paid,
            totalInvoiceAmount: inv.amount,
          }
        })

        const byStatus: Record<string, number> = {}
        let totalValue = 0
        let staleCount = 0
        for (const l of salesLeadData) {
          byStatus[l.status] = (byStatus[l.status] ?? 0) + 1
          totalValue += l.value ?? 0
          if (l.daysSinceUpdate > salesSettings.staleThresholdDays) staleCount++
        }

        const userPrompt = buildSalesUserPromptFromData(
          salesLeadData,
          {
            total: salesLeadData.length,
            byStatus,
            totalValue,
            staleCount,
          },
          agentMemories,
          businessMemories,
          salesSettings
        )

        const provider = resolveLLMProvider()
        const rawPlan = await callLLM(provider, SALES_SYSTEM_PROMPT, userPrompt, 0.1, 3000)
        plan = validateSalesPlan(rawPlan)
        agentConfig = SALES_CONFIG
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
              timezone: args.timezone,
            })
            results.push({
              type: action.type,
              target: action.target,
              success: true,
              message: 'Reminder note added to appointment',
            })
          } else if (action.type === 'create_invoice') {
            const leadName = String(action.params?.leadName ?? '').trim()
            const amount = Number(action.params?.amount ?? 0)
            const description = String(action.params?.description ?? 'Service').trim()
            const configuredTerms = sanitizeInvoiceSettings(
              args.invoiceSettings
            ).defaultPaymentTermsDays
            const defaultDueDate = new Date(Date.now() + configuredTerms * 86_400_000)
              .toISOString()
              .split('T')[0]
            const dueDate = action.params?.dueDate ? String(action.params.dueDate) : defaultDueDate

            if (amount <= 0 || !description) {
              results.push({
                type: action.type,
                target: action.target,
                success: true,
                message: 'Skipped: invalid invoice params',
              })
              skippedInExecution++
              continue
            }

            await ctx.runMutation(internal.invoices.createDraftForLeadInternal, {
              organizationId: args.organizationId,
              leadId: action.target as Id<'leads'>,
              amount,
              description,
              dueDate,
            })
            results.push({
              type: action.type,
              target: action.target,
              success: true,
              message: `Draft invoice created for ${leadName || action.target} — $${amount.toFixed(2)}`,
            })
          } else if (action.type === 'update_invoice_status') {
            const status = String(action.params?.status ?? '').trim()
            if (!['draft', 'sent', 'paid'].includes(status)) {
              results.push({
                type: action.type,
                target: action.target,
                success: true,
                message: 'Skipped: invalid invoice status',
              })
              skippedInExecution++
              continue
            }

            await ctx.runMutation(internal.invoices.updateStatusInternal, {
              organizationId: args.organizationId,
              invoiceId: action.target as Id<'invoices'>,
              status: status as 'draft' | 'sent' | 'paid',
            })
            results.push({
              type: action.type,
              target: action.target,
              success: true,
              message: `Invoice status updated to ${status}`,
            })
          } else if (action.type === 'flag_overdue_invoice') {
            const notes = String(action.params?.notes ?? '').trim()
            if (!notes) {
              results.push({
                type: action.type,
                target: action.target,
                success: true,
                message: 'Skipped: empty overdue flag',
              })
              skippedInExecution++
              continue
            }
            await ctx.runMutation(internal.invoices.flagOverdueInvoiceInternal, {
              organizationId: args.organizationId,
              invoiceId: action.target as Id<'invoices'>,
              notes,
            })
            results.push({
              type: action.type,
              target: action.target,
              success: true,
              message: `Flagged overdue invoice ${action.target}`,
            })
          } else if (action.type === 'score_lead') {
            const score = Number(action.params?.score ?? 0)
            const reasoning = String(action.params?.reasoning ?? '').trim()
            if (score < 1 || score > 10 || !reasoning) {
              results.push({
                type: action.type,
                target: action.target,
                success: true,
                message: 'Skipped: invalid score params',
              })
              skippedInExecution++
              continue
            }
            await ctx.runMutation(internal.agentRunner.updateLeadNotes, {
              organizationId: args.organizationId,
              leadId: action.target as Id<'leads'>,
              notes: `[Sales Score] ${score}/10 — ${reasoning}`,
              agentType: 'sales',
              touchLastContact: false,
            })
            results.push({
              type: action.type,
              target: action.target,
              success: true,
              message: `Lead scored ${score}/10`,
            })
          } else if (action.type === 'recommend_stage_change') {
            const recommendedStage = String(
              action.params?.recommendedStage ?? action.params?.toStage ?? ''
            ).trim()
            const reasoning = String(action.params?.reasoning ?? '').trim()
            if (!recommendedStage || !reasoning) {
              results.push({
                type: action.type,
                target: action.target,
                success: true,
                message: 'Skipped: missing stage/reasoning',
              })
              skippedInExecution++
              continue
            }
            await ctx.runMutation(internal.agentRunner.updateLeadNotes, {
              organizationId: args.organizationId,
              leadId: action.target as Id<'leads'>,
              notes: `[Stage Recommendation] Move to ${recommendedStage} — ${reasoning}`,
              agentType: 'sales',
              touchLastContact: false,
            })
            results.push({
              type: action.type,
              target: action.target,
              success: true,
              message: `Recommended stage change to ${recommendedStage}`,
            })
          } else if (action.type === 'flag_stale_lead') {
            const daysSinceUpdate = Number(
              action.params?.daysSinceUpdate ?? action.params?.daysSinceContact ?? 0
            )
            const staleNotes = String(
              action.params?.notes ?? action.params?.suggestion ?? ''
            ).trim()
            await ctx.runMutation(internal.agentRunner.updateLeadNotes, {
              organizationId: args.organizationId,
              leadId: action.target as Id<'leads'>,
              notes: `[Stale Alert] ${daysSinceUpdate}d since contact${staleNotes ? ` — ${staleNotes}` : ''}`,
              agentType: 'sales',
              touchLastContact: false,
            })
            results.push({
              type: action.type,
              target: action.target,
              success: true,
              message: `Flagged stale (${daysSinceUpdate}d)`,
            })
          } else if (action.type === 'log_pipeline_insight') {
            const insight = String(action.params?.insight ?? '').trim()
            if (!insight) {
              results.push({
                type: action.type,
                target: action.target,
                success: true,
                message: 'Skipped: empty insight',
              })
              skippedInExecution++
              continue
            }
            await ctx.runMutation(internal.agentRunner.recordAgentLearning, {
              organizationId: args.organizationId,
              agentType: 'sales',
              category: 'pattern',
              content: insight,
              confidence: 0.7,
            })
            results.push({
              type: action.type,
              target: action.target,
              success: true,
              message: `Pipeline insight logged`,
            })
          } else if (
            action.type === 'log_recommendation' ||
            action.type === 'log_reminder_recommendation' ||
            action.type === 'log_invoice_recommendation' ||
            action.type === 'log_sales_recommendation'
          ) {
            results.push({
              type: action.type,
              target: action.target,
              success: true,
              message: String(action.params?.recommendation ?? action.params?.status ?? ''),
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
        await ctx.runMutation(internal.agentRunner.recordAgentLearning, {
          organizationId: args.organizationId,
          agentType: args.agentType,
          category: 'success',
          content: `Executed ${successes.length} ${args.agentType} actions.`,
          confidence: 0.8,
        })
      }

      if (failures.length > 0) {
        const errorSummary = failures.map((f) => `${f.type}: ${f.message}`).join('; ')
        await ctx.runMutation(internal.agentRunner.recordAgentLearning, {
          organizationId: args.organizationId,
          agentType: args.agentType,
          category: 'failure',
          content: `Failed ${failures.length} ${args.agentType} actions: ${errorSummary}`,
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

export const getOrgTimezone = internalQuery({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.organizationId)
    return org?.settings?.timezone ?? null
  },
})

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
    touchLastContact: v.optional(v.boolean()),
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
    const labelMap: Record<string, string> = {
      reminder: 'Reminder',
      sales: 'Sales',
    }
    const label = labelMap[args.agentType ?? ''] ?? 'Agent'
    if (label === 'Reminder' && existingNotes.includes(`[Reminder ${timestamp}]`)) {
      return
    }
    const noteEntry = `[${label} ${timestamp}] ${noteText}`
    if (existingNotes.includes(noteEntry)) return
    const updatedNotes = existingNotes ? `${existingNotes}\n${noteEntry}` : noteEntry
    const touchLastContact = args.touchLastContact ?? true

    const now = Date.now()
    await ctx.db.patch(args.leadId, {
      notes: updatedNotes,
      updatedAt: now,
      ...(touchLastContact ? { lastContact: now } : {}),
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

export function selectReminderCandidates(
  appointments: ReminderAppointmentDoc[],
  now: number,
  windowEnd: number,
  tz = 'UTC'
): ReminderAppointmentCandidate[] {
  return appointments
    .filter((appointment) => {
      if (appointment.status !== 'scheduled') return false
      if (appointment.notes?.includes('[Reminder')) return false

      const apptTime = appointmentToEpoch(appointment.date, appointment.time, tz)
      if (Number.isNaN(apptTime)) return false
      if (apptTime <= now || apptTime > windowEnd) return false
      return true
    })
    .map((appointment) => {
      const apptTime = appointmentToEpoch(appointment.date, appointment.time, tz)
      const rawHours = Math.round((apptTime - now) / MS_PER_HOUR)
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
        appointmentTime: apptTime,
      }
    })
}

export const getUpcomingAppointmentsForReminder = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    windowHours: v.number(),
    maxAppointments: v.number(),
    now: v.number(),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = args.now
    const tz = resolveTimezone(args.timezone)
    const windowEnd = now + args.windowHours * MS_PER_HOUR

    const today = todayInTimezone(tz, now)
    const windowEndDate = epochToDateInTimezone(windowEnd, tz)

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
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get(args.appointmentId)
    if (!appointment) throw new Error(`Appointment not found: ${args.appointmentId}`)
    if (appointment.organizationId !== args.organizationId) {
      throw new Error('Appointment does not belong to this organization')
    }

    const tz = resolveTimezone(args.timezone)
    const timestamp = todayInTimezone(tz)
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

// ── Sales-specific helpers ────────────────────────────────────────────

export const getLeadsForSalesPipeline = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    maxLeads: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const activeStatuses = ['New', 'Contacted', 'Qualified', 'Proposal', 'Booked'] as const

    const perStatusCap = Math.ceil(args.maxLeads * 2)
    const leadsByStatus = await Promise.all(
      activeStatuses.map((status) =>
        ctx.db
          .query('leads')
          .withIndex('by_org_status', (q) =>
            q.eq('organizationId', args.organizationId).eq('status', status)
          )
          .take(perStatusCap)
      )
    )

    const now = args.now
    return leadsByStatus
      .flat()
      .sort((a, b) => (a.lastContact ?? a.createdAt) - (b.lastContact ?? b.createdAt))
      .slice(0, args.maxLeads)
      .map((lead) => ({
        id: String(lead._id),
        name: lead.name,
        status: lead.status,
        phone: lead.phone,
        email: lead.email,
        value: lead.value,
        tags: lead.tags,
        notes: lead.notes,
        lastContact: lead.lastContact ?? lead.createdAt,
        daysSinceContact: Math.floor((now - (lead.lastContact ?? lead.createdAt)) / MS_PER_DAY),
        createdAt: lead.createdAt,
      }))
  },
})

export const getAppointmentsForLeads = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    leadIds: v.array(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const effectiveLimit = Math.min(Math.max(args.limit, 1), 500)
    const uniqueLeadIds = [...new Set(args.leadIds)]
    if (uniqueLeadIds.length === 0) return []

    const perLeadTake = Math.min(
      Math.max(Math.ceil(effectiveLimit / uniqueLeadIds.length) * 2, 5),
      100
    )
    const appointmentsByLead = await Promise.all(
      uniqueLeadIds.map((leadId) =>
        ctx.db
          .query('appointments')
          .withIndex('by_lead', (q) => q.eq('leadId', leadId as Id<'leads'>))
          .order('desc')
          .take(perLeadTake)
      )
    )

    return appointmentsByLead
      .flat()
      .filter((a) => a.organizationId === args.organizationId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, effectiveLimit)
      .map((a) => ({
        id: String(a._id),
        leadId: String(a.leadId),
        leadName: a.leadName,
        date: a.date,
        time: a.time,
        title: a.title,
        status: a.status,
      }))
  },
})

export const getInvoicesForLeads = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    leadIds: v.array(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const effectiveLimit = Math.min(Math.max(args.limit, 1), 500)
    const uniqueLeadIds = [...new Set(args.leadIds)]
    if (uniqueLeadIds.length === 0) return []

    const perLeadTake = Math.min(
      Math.max(Math.ceil(effectiveLimit / uniqueLeadIds.length) * 2, 5),
      100
    )
    const invoicesByLead = await Promise.all(
      uniqueLeadIds.map((leadId) =>
        ctx.db
          .query('invoices')
          .withIndex('by_lead', (q) => q.eq('leadId', leadId as Id<'leads'>))
          .order('desc')
          .take(perLeadTake)
      )
    )

    return invoicesByLead
      .flat()
      .filter((i) => i.organizationId === args.organizationId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, effectiveLimit)
      .map((i) => ({
        id: String(i._id),
        leadId: String(i.leadId),
        leadName: i.leadName,
        amount: i.amount,
        status: i.status,
        dueDate: i.dueDate,
        createdAt: i.createdAt,
      }))
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

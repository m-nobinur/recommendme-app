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
import { assessAction } from './agentLogic/risk'
import { callLLM, resolveLLMProvider } from './llmProvider'

/**
 * Run the followup agent for all organizations that have it enabled.
 * Triggered by the daily cron job.
 */
export const runFollowupAgent = internalAction({
  args: {},
  handler: async (ctx) => {
    const enabledDefs: Doc<'agentDefinitions'>[] = await ctx.runQuery(
      internal.agentDefinitions.listEnabledByType,
      { agentType: 'followup' }
    )

    if (enabledDefs.length === 0) {
      console.log('[AgentRunner] No enabled followup agents found')
      return { processed: 0 }
    }

    let processed = 0
    for (const def of enabledDefs) {
      try {
        await ctx.runAction(internal.agentRunner.runAgentForOrg, {
          organizationId: def.organizationId,
          agentType: 'followup',
          triggerType: 'cron',
        })
        processed++
      } catch (error) {
        console.error('[AgentRunner] Failed for org:', {
          organizationId: String(def.organizationId),
          error: error instanceof Error ? error.message : 'Unknown',
        })
      }
    }

    return { processed }
  },
})

/**
 * Run a specific agent for a specific organization.
 * This is the main execution entry point.
 */
export const runAgentForOrg = internalAction({
  args: {
    organizationId: v.id('organizations'),
    agentType: v.literal('followup'),
    triggerType: v.string(),
    triggerId: v.optional(v.string()),
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

      const leads = await ctx.runQuery(internal.agentRunner.getStaleLeads, {
        organizationId: args.organizationId,
        staleDaysThreshold: 3,
        targetStatuses: ['Contacted', 'Qualified', 'Proposal'],
        maxLeads: 20,
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

      const plan = validateFollowupPlan(rawPlan)

      await ctx.runMutation(internal.agentExecutions.updateStatus, {
        id: executionId,
        status: 'risk_assessing',
        plan: plan,
      })

      const { guardrails } = FOLLOWUP_CONFIG
      const approved: Array<{
        type: string
        target: string
        params: Record<string, unknown>
        riskLevel: 'low' | 'medium' | 'high'
        reasoning: string
      }> = []
      const rejected: Array<{ type: string; target: string; reason: string }> = []
      const actions = plan.actions.slice(0, guardrails.maxActionsPerRun)

      for (const action of actions) {
        if (!guardrails.allowedActions.includes(action.type)) {
          rejected.push({
            type: action.type,
            target: action.target,
            reason: 'Action not in allowed list',
          })
          continue
        }

        const assessment = assessAction(action, guardrails)

        if (!assessment.approved) {
          rejected.push({
            type: action.type,
            target: action.target,
            reason:
              assessment.reason ?? `Risk level '${assessment.assessedRisk}' requires approval`,
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

      const skipped = plan.actions.length - approved.length

      await ctx.runMutation(internal.agentExecutions.updateStatus, {
        id: executionId,
        status: 'executing',
      })

      let executed = 0
      const results: Array<{ type: string; target: string; success: boolean; message: string }> = []

      for (const action of approved) {
        try {
          if (action.type === 'update_lead_notes') {
            await ctx.runMutation(internal.agentRunner.updateLeadNotes, {
              organizationId: args.organizationId,
              leadId: action.target as Id<'leads'>,
              notes: String(action.params?.notes ?? ''),
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
          } else if (action.type === 'log_recommendation') {
            results.push({
              type: action.type,
              target: action.target,
              success: true,
              message: String(action.params?.recommendation ?? ''),
            })
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
          content: `Executed ${successes.length} followup actions for ${leads.length} stale leads.`,
          confidence: 0.8,
        })
      }

      if (failures.length > 0) {
        const errorSummary = failures.map((f) => `${f.type}: ${f.message}`).join('; ')
        await ctx.runMutation(internal.agentRunner.recordAgentLearning, {
          organizationId: args.organizationId,
          agentType: args.agentType,
          category: 'failure',
          content: `Failed ${failures.length} followup actions: ${errorSummary}`,
          confidence: 0.6,
        })
      }

      const status = rejected.length > 0 ? ('awaiting_approval' as const) : ('completed' as const)
      await ctx.runMutation(internal.agentExecutions.complete, {
        id: executionId,
        status,
        results,
        actionsPlanned: plan.actions.length,
        actionsExecuted: executed,
        actionsSkipped: skipped,
      })

      return {
        status,
        actionsPlanned: plan.actions.length,
        actionsExecuted: executed,
        actionsSkipped: skipped,
        actionsRejectedForApproval: rejected.length,
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
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.staleDaysThreshold * MS_PER_DAY
    const now = Date.now()

    const allLeads = await ctx.db
      .query('leads')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect()

    return allLeads
      .filter((lead) => {
        const lastContact = lead.lastContact ?? lead.createdAt
        return args.targetStatuses.includes(lead.status) && lastContact < cutoff
      })
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
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId)
    if (!lead) throw new Error(`Lead not found: ${args.leadId}`)
    if (lead.organizationId !== args.organizationId) {
      throw new Error('Lead does not belong to this organization')
    }

    const existingNotes = lead.notes ?? ''
    const timestamp = new Date().toISOString().split('T')[0]
    const updatedNotes = existingNotes
      ? `${existingNotes}\n[Agent ${timestamp}] ${args.notes}`
      : `[Agent ${timestamp}] ${args.notes}`

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

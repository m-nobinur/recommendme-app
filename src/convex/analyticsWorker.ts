import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { isCronDisabled } from './lib/cronGuard'

/**
 * Analytics Worker (Phase 8.8)
 *
 * Pre-computes daily analytics snapshots per organization. Replaces
 * live aggregation in dashboard components with indexed reads, reducing
 * Convex read-unit cost at scale and enabling time-series trending.
 *
 * Computed metrics:
 *   - Lead stats: total, by status, total pipeline value
 *   - Appointment stats: total, by status
 *   - Invoice stats: total, by status, revenue
 *   - Memory stats: total active, by type, avg decay, archived count
 *   - AI usage stats: total tokens, estimated cost, call count
 *   - Agent stats: executions by type, success rate
 *
 * Schedule: daily at 06:00 UTC
 */

const ORG_PAGE_SIZE = 100
const QUERY_CAP = 1000

export const computeLeadStats = internalQuery({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) => {
    const leads = await ctx.db
      .query('leads')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .take(QUERY_CAP)

    const byStatus: Record<string, number> = {}
    let totalValue = 0

    for (const lead of leads) {
      byStatus[lead.status] = (byStatus[lead.status] ?? 0) + 1
      totalValue += lead.value ?? 0
    }

    return { total: leads.length, byStatus, totalValue, truncated: leads.length >= QUERY_CAP }
  },
})

export const computeAppointmentStats = internalQuery({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) => {
    const appointments = await ctx.db
      .query('appointments')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .take(QUERY_CAP)

    const byStatus: Record<string, number> = {}
    for (const appt of appointments) {
      byStatus[appt.status] = (byStatus[appt.status] ?? 0) + 1
    }

    return {
      total: appointments.length,
      byStatus,
      truncated: appointments.length >= QUERY_CAP,
    }
  },
})

export const computeInvoiceStats = internalQuery({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) => {
    const invoices = await ctx.db
      .query('invoices')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .take(QUERY_CAP)

    const byStatus: Record<string, number> = {}
    let totalRevenue = 0
    let paidRevenue = 0

    for (const inv of invoices) {
      byStatus[inv.status] = (byStatus[inv.status] ?? 0) + 1
      totalRevenue += inv.amount
      if (inv.status === 'paid') paidRevenue += inv.amount
    }

    return {
      total: invoices.length,
      byStatus,
      totalRevenue,
      paidRevenue,
      truncated: invoices.length >= QUERY_CAP,
    }
  },
})

export const computeMemoryStats = internalQuery({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) => {
    const active = await ctx.db
      .query('businessMemories')
      .withIndex('by_org_active', (q) =>
        q.eq('organizationId', args.organizationId).eq('isActive', true)
      )
      .take(500)

    const archived = await ctx.db
      .query('businessMemories')
      .withIndex('by_org_archived', (q) =>
        q.eq('organizationId', args.organizationId).eq('isArchived', true)
      )
      .take(200)

    const byType: Record<string, number> = {}
    let totalDecay = 0
    for (const m of active) {
      byType[m.type] = (byType[m.type] ?? 0) + 1
      totalDecay += m.decayScore
    }

    return {
      totalActive: active.length,
      totalArchived: archived.length,
      byType,
      avgDecayScore: active.length > 0 ? totalDecay / active.length : 0,
    }
  },
})

export const computeAiUsageStats = internalQuery({
  args: { organizationId: v.id('organizations'), since: v.number() },
  handler: async (ctx, args) => {
    const usage = await ctx.db
      .query('llmUsage')
      .withIndex('by_org_created', (q) =>
        q.eq('organizationId', args.organizationId).gte('createdAt', args.since)
      )
      .take(1000)

    let totalTokens = 0
    let totalCost = 0
    const byPurpose: Record<string, number> = {}

    for (const record of usage) {
      totalTokens += record.totalTokens
      totalCost += record.estimatedCostUsd
      byPurpose[record.purpose] = (byPurpose[record.purpose] ?? 0) + 1
    }

    return { callCount: usage.length, totalTokens, totalCostUsd: totalCost, byPurpose }
  },
})

export const computeAgentStats = internalQuery({
  args: { organizationId: v.id('organizations'), since: v.number() },
  handler: async (ctx, args) => {
    const executions = await ctx.db
      .query('agentExecutions')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .take(500)

    const recentExecutions = executions.filter((e) => e.createdAt >= args.since)

    const byAgent: Record<string, { total: number; completed: number; failed: number }> = {}
    for (const exec of recentExecutions) {
      const entry = byAgent[exec.agentType] ?? { total: 0, completed: 0, failed: 0 }
      entry.total++
      if (exec.status === 'completed') entry.completed++
      if (exec.status === 'failed') entry.failed++
      byAgent[exec.agentType] = entry
    }

    return {
      totalExecutions: recentExecutions.length,
      byAgent,
    }
  },
})

export const saveDailySnapshot = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    date: v.string(),
    leads: v.object({
      total: v.number(),
      byStatus: v.any(),
      totalValue: v.number(),
    }),
    appointments: v.object({
      total: v.number(),
      byStatus: v.any(),
    }),
    invoices: v.object({
      total: v.number(),
      byStatus: v.any(),
      totalRevenue: v.number(),
      paidRevenue: v.number(),
    }),
    memory: v.object({
      totalActive: v.number(),
      totalArchived: v.number(),
      byType: v.any(),
      avgDecayScore: v.number(),
    }),
    aiUsage: v.object({
      callCount: v.number(),
      totalTokens: v.number(),
      totalCostUsd: v.float64(),
      byPurpose: v.any(),
    }),
    agents: v.object({
      totalExecutions: v.number(),
      byAgent: v.any(),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('dailyAnalytics')
      .withIndex('by_org_date', (q) =>
        q.eq('organizationId', args.organizationId).eq('date', args.date)
      )
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        leads: args.leads,
        appointments: args.appointments,
        invoices: args.invoices,
        memory: args.memory,
        aiUsage: args.aiUsage,
        agents: args.agents,
        updatedAt: Date.now(),
      })
      return existing._id
    }

    return await ctx.db.insert('dailyAnalytics', {
      organizationId: args.organizationId,
      date: args.date,
      leads: args.leads,
      appointments: args.appointments,
      invoices: args.invoices,
      memory: args.memory,
      aiUsage: args.aiUsage,
      agents: args.agents,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  },
})

async function listAllOrganizationIds(ctx: {
  runQuery: (...args: any[]) => Promise<any>
}): Promise<Id<'organizations'>[]> {
  const orgIds: Id<'organizations'>[] = []
  let cursor: string | null = null

  do {
    const page = await ctx.runQuery(internal.memoryDecay.listOrganizations, {
      paginationOpts: { numItems: ORG_PAGE_SIZE, cursor },
    })
    for (const org of page.page) {
      orgIds.push(org._id as Id<'organizations'>)
    }
    cursor = page.isDone ? null : page.continueCursor
  } while (cursor)

  return orgIds
}

export const runDailyAnalytics = internalAction({
  args: {},
  handler: async (ctx): Promise<{ orgsProcessed: number }> => {
    if (isCronDisabled()) return { orgsProcessed: 0 }

    const orgIds = await listAllOrganizationIds(ctx)
    const now = Date.now()
    const todayDate = new Date(now).toISOString().split('T')[0]
    const dayStart = new Date(`${todayDate}T00:00:00Z`).getTime()

    let orgsProcessed = 0

    for (const orgId of orgIds) {
      try {
        const [leads, appointments, invoices, memory, aiUsage, agents] = await Promise.all([
          ctx.runQuery(internal.analyticsWorker.computeLeadStats, { organizationId: orgId }),
          ctx.runQuery(internal.analyticsWorker.computeAppointmentStats, { organizationId: orgId }),
          ctx.runQuery(internal.analyticsWorker.computeInvoiceStats, { organizationId: orgId }),
          ctx.runQuery(internal.analyticsWorker.computeMemoryStats, { organizationId: orgId }),
          ctx.runQuery(internal.analyticsWorker.computeAiUsageStats, {
            organizationId: orgId,
            since: dayStart,
          }),
          ctx.runQuery(internal.analyticsWorker.computeAgentStats, {
            organizationId: orgId,
            since: dayStart,
          }),
        ])

        const truncations: string[] = []
        if (leads.truncated) truncations.push('leads')
        if (appointments.truncated) truncations.push('appointments')
        if (invoices.truncated) truncations.push('invoices')
        if (truncations.length > 0) {
          console.warn(
            `[Analytics] Truncated data for org ${orgId}: ${truncations.join(', ')} hit ${QUERY_CAP} cap`
          )
        }

        await ctx.runMutation(internal.analyticsWorker.saveDailySnapshot, {
          organizationId: orgId,
          date: todayDate,
          leads: leads as any,
          appointments: appointments as any,
          invoices: invoices as any,
          memory: memory as any,
          aiUsage: aiUsage as any,
          agents: agents as any,
        })

        orgsProcessed++
      } catch (error) {
        console.error(
          `[Analytics] Failed to compute snapshot for org ${orgId}:`,
          error instanceof Error ? error.message : error
        )
      }
    }

    if (orgsProcessed > 0) {
      console.log(`[Analytics] Generated daily snapshots for ${orgsProcessed} organizations`)
    }

    return { orgsProcessed }
  },
})

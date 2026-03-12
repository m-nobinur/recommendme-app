import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, mutation, query } from './_generated/server'
import { assertAuthenticatedUserInOrganization } from './lib/auth'
import { boundedPageSize, llmPurposeValues } from './lib/validators'
import { assertMemoryApiToken } from './security'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const USAGE_RETENTION_DAYS = 90

export const record = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    traceId: v.optional(v.string()),
    model: v.string(),
    provider: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    estimatedCostUsd: v.float64(),
    purpose: llmPurposeValues,
    cached: v.boolean(),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('llmUsage', {
      ...args,
      createdAt: Date.now(),
    })
  },
})

export const recordBatch = internalMutation({
  args: {
    records: v.array(
      v.object({
        organizationId: v.id('organizations'),
        traceId: v.optional(v.string()),
        model: v.string(),
        provider: v.string(),
        inputTokens: v.number(),
        outputTokens: v.number(),
        totalTokens: v.number(),
        estimatedCostUsd: v.float64(),
        purpose: llmPurposeValues,
        cached: v.boolean(),
        latencyMs: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const ids = []
    for (const record of args.records) {
      const id = await ctx.db.insert('llmUsage', {
        ...record,
        createdAt: now,
      })
      ids.push(id)
    }
    return ids
  },
})

export const recordUsage = mutation({
  args: {
    authToken: v.optional(v.string()),
    organizationId: v.id('organizations'),
    traceId: v.optional(v.string()),
    model: v.string(),
    provider: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    estimatedCostUsd: v.float64(),
    purpose: llmPurposeValues,
    cached: v.boolean(),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    assertMemoryApiToken(args.authToken, 'llmUsage.recordUsage')
    const { authToken: _, ...usageData } = args
    return await ctx.db.insert('llmUsage', {
      ...usageData,
      createdAt: Date.now(),
    })
  },
})

export const getOrgUsage = query({
  args: {
    organizationId: v.id('organizations'),
    sinceMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertAuthenticatedUserInOrganization(ctx, args.organizationId)
    const pageSize = boundedPageSize(args.limit, DEFAULT_LIMIT, MAX_LIMIT)
    const since = args.sinceMs ?? 0

    const filtered =
      since > 0
        ? await ctx.db
            .query('llmUsage')
            .withIndex('by_org_created', (q) =>
              q.eq('organizationId', args.organizationId).gte('createdAt', since)
            )
            .order('desc')
            .take(pageSize)
        : await ctx.db
            .query('llmUsage')
            .withIndex('by_org_created', (q) => q.eq('organizationId', args.organizationId))
            .order('desc')
            .take(pageSize)

    let totalTokens = 0
    let totalCostUsd = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    const byPurpose: Record<string, { tokens: number; costUsd: number; count: number }> = {}
    const byModel: Record<string, { tokens: number; costUsd: number; count: number }> = {}

    for (const row of filtered) {
      totalTokens += row.totalTokens
      totalCostUsd += row.estimatedCostUsd
      totalInputTokens += row.inputTokens
      totalOutputTokens += row.outputTokens

      if (!byPurpose[row.purpose]) {
        byPurpose[row.purpose] = { tokens: 0, costUsd: 0, count: 0 }
      }
      byPurpose[row.purpose].tokens += row.totalTokens
      byPurpose[row.purpose].costUsd += row.estimatedCostUsd
      byPurpose[row.purpose].count += 1

      if (!byModel[row.model]) {
        byModel[row.model] = { tokens: 0, costUsd: 0, count: 0 }
      }
      byModel[row.model].tokens += row.totalTokens
      byModel[row.model].costUsd += row.estimatedCostUsd
      byModel[row.model].count += 1
    }

    return {
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      recordCount: filtered.length,
      byPurpose,
      byModel,
    }
  },
})

export const getOrgBudgetStatus = query({
  args: {
    organizationId: v.id('organizations'),
    dailyLimitTokens: v.number(),
    monthlyLimitTokens: v.number(),
    nowMs: v.number(),
    maxRows: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertAuthenticatedUserInOrganization(ctx, args.organizationId)

    const now = args.nowMs
    const dayStart = now - 24 * 60 * 60 * 1000
    const monthStart = now - 30 * 24 * 60 * 60 * 1000
    const scanLimit = boundedPageSize(args.maxRows, 2_000, 10_000)

    const recent = await ctx.db
      .query('llmUsage')
      .withIndex('by_org_created', (q) =>
        q.eq('organizationId', args.organizationId).gte('createdAt', monthStart)
      )
      .order('desc')
      .take(scanLimit)

    let dailyTokens = 0
    let dailyCostUsd = 0
    let monthlyTokens = 0
    let monthlyCostUsd = 0

    for (const row of recent) {
      if (row.createdAt < monthStart) break
      monthlyTokens += row.totalTokens
      monthlyCostUsd += row.estimatedCostUsd
      if (row.createdAt >= dayStart) {
        dailyTokens += row.totalTokens
        dailyCostUsd += row.estimatedCostUsd
      }
    }

    const oldestFetched = recent.length > 0 ? (recent[recent.length - 1]?.createdAt ?? now) : now
    const truncated = recent.length >= scanLimit && oldestFetched > monthStart

    return {
      daily: {
        tokensUsed: dailyTokens,
        tokenLimit: args.dailyLimitTokens,
        percentUsed:
          args.dailyLimitTokens > 0
            ? Math.round((dailyTokens / args.dailyLimitTokens) * 10000) / 100
            : 0,
        costUsd: Math.round(dailyCostUsd * 1_000_000) / 1_000_000,
      },
      monthly: {
        tokensUsed: monthlyTokens,
        tokenLimit: args.monthlyLimitTokens,
        percentUsed:
          args.monthlyLimitTokens > 0
            ? Math.round((monthlyTokens / args.monthlyLimitTokens) * 10000) / 100
            : 0,
        costUsd: Math.round(monthlyCostUsd * 1_000_000) / 1_000_000,
      },
      truncated,
    }
  },
})

export const purgeOldUsage = internalMutation({
  args: { retentionDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const retention = args.retentionDays ?? USAGE_RETENTION_DAYS
    const cutoff = Date.now() - retention * 24 * 60 * 60 * 1000
    const BATCH_SIZE = 500

    const old = await ctx.db
      .query('llmUsage')
      .withIndex('by_created', (q) => q.lt('createdAt', cutoff))
      .take(BATCH_SIZE)

    for (const row of old) {
      await ctx.db.delete(row._id)
    }

    const hasMore = old.length >= BATCH_SIZE
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.llmUsage.purgeOldUsage, {
        retentionDays: retention,
      })
    }

    return { deleted: old.length, hasMore }
  },
})

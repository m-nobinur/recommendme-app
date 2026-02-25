import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { internalMutation, internalQuery, query } from './_generated/server'
import { assertUserInOrganization } from './lib/auth'

const executionStatusValues = v.union(
  v.literal('pending'),
  v.literal('loading_context'),
  v.literal('planning'),
  v.literal('risk_assessing'),
  v.literal('executing'),
  v.literal('awaiting_approval'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('skipped')
)

const ACTIVE_STATUSES = new Set([
  'pending',
  'loading_context',
  'planning',
  'risk_assessing',
  'executing',
])

const EXECUTION_LOCK_TTL_MS = 90 * 60 * 1000

export const create = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    agentType: v.string(),
    triggerType: v.string(),
    triggerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    return await ctx.db.insert('agentExecutions', {
      organizationId: args.organizationId,
      agentType: args.agentType,
      triggerType: args.triggerType,
      triggerId: args.triggerId,
      status: 'pending',
      startedAt: now,
      createdAt: now,
    })
  },
})

export const createIfNotRunning = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    agentType: v.string(),
    triggerType: v.string(),
    triggerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const existingLock = await ctx.db
      .query('agentExecutionLocks')
      .withIndex('by_org_agent', (q) =>
        q.eq('organizationId', args.organizationId).eq('agentType', args.agentType)
      )
      .first()

    if (existingLock && existingLock.expiresAt > now) {
      return {
        skipped: true as const,
        reason: 'already_running' as const,
        executionId: existingLock.executionId,
      }
    }

    if (existingLock && existingLock.expiresAt <= now) {
      await ctx.db.delete(existingLock._id)
    }

    const recent = await ctx.db
      .query('agentExecutions')
      .withIndex('by_org_agent', (q) =>
        q.eq('organizationId', args.organizationId).eq('agentType', args.agentType)
      )
      .order('desc')
      .take(20)

    const active = recent.find((exec) => ACTIVE_STATUSES.has(exec.status))
    if (active) {
      return {
        skipped: true as const,
        reason: 'already_running' as const,
        executionId: active._id,
      }
    }

    const executionId = await ctx.db.insert('agentExecutions', {
      organizationId: args.organizationId,
      agentType: args.agentType,
      triggerType: args.triggerType,
      triggerId: args.triggerId,
      status: 'pending',
      startedAt: now,
      createdAt: now,
    })

    const lockId = await ctx.db.insert('agentExecutionLocks', {
      organizationId: args.organizationId,
      agentType: args.agentType,
      executionId,
      acquiredAt: now,
      expiresAt: now + EXECUTION_LOCK_TTL_MS,
    })

    const competingLocks = await ctx.db
      .query('agentExecutionLocks')
      .withIndex('by_org_agent', (q) =>
        q.eq('organizationId', args.organizationId).eq('agentType', args.agentType)
      )
      .collect()

    if (competingLocks.length > 1) {
      const primary = [...competingLocks].sort((a, b) => {
        if (a.acquiredAt !== b.acquiredAt) return a.acquiredAt - b.acquiredAt
        return String(a._id).localeCompare(String(b._id))
      })[0]

      if (primary && primary._id !== lockId) {
        await ctx.db.delete(lockId)
        await ctx.db.patch(executionId, {
          status: 'skipped',
          completedAt: Date.now(),
          durationMs: 0,
          error: 'Skipped due to concurrent execution lock contention',
        })

        return {
          skipped: true as const,
          reason: 'already_running' as const,
          executionId: primary.executionId,
        }
      }
    }

    return {
      skipped: false as const,
      reason: null,
      executionId,
    }
  },
})

export const updateStatus = internalMutation({
  args: {
    id: v.id('agentExecutions'),
    status: executionStatusValues,
    plan: v.optional(v.any()),
    memoryContext: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = { status: args.status }
    if (args.plan !== undefined) updates.plan = args.plan
    if (args.memoryContext !== undefined) updates.memoryContext = args.memoryContext
    await ctx.db.patch(args.id, updates)
  },
})

export const complete = internalMutation({
  args: {
    id: v.id('agentExecutions'),
    status: executionStatusValues,
    results: v.optional(v.any()),
    actionsPlanned: v.optional(v.number()),
    actionsExecuted: v.optional(v.number()),
    actionsSkipped: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing) return

    const now = Date.now()
    await ctx.db.patch(args.id, {
      status: args.status,
      results: args.results,
      actionsPlanned: args.actionsPlanned,
      actionsExecuted: args.actionsExecuted,
      actionsSkipped: args.actionsSkipped,
      error: args.error,
      completedAt: now,
      durationMs: now - existing.startedAt,
    })

    const lock = await ctx.db
      .query('agentExecutionLocks')
      .withIndex('by_org_agent', (q) =>
        q.eq('organizationId', existing.organizationId).eq('agentType', existing.agentType)
      )
      .first()
    if (lock && lock.executionId === args.id) {
      await ctx.db.delete(lock._id)
    }
  },
})

export const fail = internalMutation({
  args: {
    id: v.id('agentExecutions'),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing) return

    const now = Date.now()
    await ctx.db.patch(args.id, {
      status: 'failed',
      error: args.error,
      completedAt: now,
      durationMs: now - existing.startedAt,
    })

    const lock = await ctx.db
      .query('agentExecutionLocks')
      .withIndex('by_org_agent', (q) =>
        q.eq('organizationId', existing.organizationId).eq('agentType', existing.agentType)
      )
      .first()
    if (lock && lock.executionId === args.id) {
      await ctx.db.delete(lock._id)
    }
  },
})

export const list = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    agentType: v.optional(v.string()),
    status: v.optional(executionStatusValues),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const pageSize = Math.min(args.limit ?? 20, 100)

    let results: Doc<'agentExecutions'>[]

    const { agentType, status } = args

    if (agentType && status) {
      results = await ctx.db
        .query('agentExecutions')
        .withIndex('by_org_agent_status', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('agentType', agentType)
            .eq('status', status)
        )
        .order('desc')
        .take(pageSize)
    } else if (agentType) {
      results = await ctx.db
        .query('agentExecutions')
        .withIndex('by_org_agent', (q) =>
          q.eq('organizationId', args.organizationId).eq('agentType', agentType)
        )
        .order('desc')
        .take(pageSize)
    } else if (status) {
      results = await ctx.db
        .query('agentExecutions')
        .withIndex('by_org_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', status)
        )
        .order('desc')
        .take(pageSize)
    } else {
      results = await ctx.db
        .query('agentExecutions')
        .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
        .order('desc')
        .take(pageSize)
    }

    return results
  },
})

export const getRecent = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    agentType: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 5, 20)
    return await ctx.db
      .query('agentExecutions')
      .withIndex('by_org_agent', (q) =>
        q.eq('organizationId', args.organizationId).eq('agentType', args.agentType)
      )
      .order('desc')
      .take(pageSize)
  },
})

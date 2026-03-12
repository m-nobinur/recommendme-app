import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, mutation, query } from './_generated/server'
import { assertAuthenticatedUserInOrganization } from './lib/auth'
import { boundedPageSize, spanStatusValues, spanTypeValues } from './lib/validators'
import { assertMemoryApiToken } from './security'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const TRACE_RETENTION_DAYS = 30

export const record = internalMutation({
  args: {
    traceId: v.string(),
    spanId: v.string(),
    parentSpanId: v.optional(v.string()),
    organizationId: v.optional(v.id('organizations')),
    operationName: v.string(),
    spanType: spanTypeValues,
    status: spanStatusValues,
    startTime: v.number(),
    endTime: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    attributes: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('traces', {
      ...args,
      createdAt: Date.now(),
    })
  },
})

export const recordBatch = internalMutation({
  args: {
    spans: v.array(
      v.object({
        traceId: v.string(),
        spanId: v.string(),
        parentSpanId: v.optional(v.string()),
        organizationId: v.optional(v.id('organizations')),
        operationName: v.string(),
        spanType: spanTypeValues,
        status: spanStatusValues,
        startTime: v.number(),
        endTime: v.optional(v.number()),
        durationMs: v.optional(v.number()),
        attributes: v.optional(v.any()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const ids = []
    for (const span of args.spans) {
      const id = await ctx.db.insert('traces', {
        ...span,
        createdAt: now,
      })
      ids.push(id)
    }
    return ids
  },
})

export const recordSpans = mutation({
  args: {
    authToken: v.optional(v.string()),
    spans: v.array(
      v.object({
        traceId: v.string(),
        spanId: v.string(),
        parentSpanId: v.optional(v.string()),
        organizationId: v.optional(v.id('organizations')),
        operationName: v.string(),
        spanType: spanTypeValues,
        status: spanStatusValues,
        startTime: v.number(),
        endTime: v.optional(v.number()),
        durationMs: v.optional(v.number()),
        attributes: v.optional(v.any()),
      })
    ),
  },
  handler: async (ctx, args) => {
    assertMemoryApiToken(args.authToken, 'traces.recordSpans')
    const now = Date.now()
    const ids = []
    for (const span of args.spans) {
      const id = await ctx.db.insert('traces', {
        ...span,
        createdAt: now,
      })
      ids.push(id)
    }
    return ids
  },
})

export const listByTrace = query({
  args: {
    traceId: v.string(),
    organizationId: v.id('organizations'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertAuthenticatedUserInOrganization(ctx, args.organizationId)
    const pageSize = boundedPageSize(args.limit, DEFAULT_LIMIT, MAX_LIMIT)

    return await ctx.db
      .query('traces')
      .withIndex('by_org_trace_start', (q) =>
        q.eq('organizationId', args.organizationId).eq('traceId', args.traceId)
      )
      .order('asc')
      .take(pageSize)
  },
})

export const listByOrg = query({
  args: {
    organizationId: v.id('organizations'),
    spanType: v.optional(spanTypeValues),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertAuthenticatedUserInOrganization(ctx, args.organizationId)
    const pageSize = boundedPageSize(args.limit, DEFAULT_LIMIT, MAX_LIMIT)

    const spanType = args.spanType
    if (spanType) {
      return await ctx.db
        .query('traces')
        .withIndex('by_org_span_type_created', (q) =>
          q.eq('organizationId', args.organizationId).eq('spanType', spanType)
        )
        .order('desc')
        .take(pageSize)
    }

    return await ctx.db
      .query('traces')
      .withIndex('by_org_created', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')
      .take(pageSize)
  },
})

export const purgeOldTraces = internalMutation({
  args: { retentionDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const retention = args.retentionDays ?? TRACE_RETENTION_DAYS
    const cutoff = Date.now() - retention * 24 * 60 * 60 * 1000
    const BATCH_SIZE = 500

    const old = await ctx.db
      .query('traces')
      .withIndex('by_created', (q) => q.lt('createdAt', cutoff))
      .take(BATCH_SIZE)

    for (const row of old) {
      await ctx.db.delete(row._id)
    }

    const hasMore = old.length >= BATCH_SIZE
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.traces.purgeOldTraces, {
        retentionDays: retention,
      })
    }

    return { deleted: old.length, hasMore }
  },
})

import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { internalMutation, query } from './_generated/server'
import { assertUserInOrganization } from './lib/auth'
import { actorTypeValues, boundedPageSize, riskLevelValues } from './lib/validators'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export const append = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    userId: v.optional(v.id('appUsers')),
    actorType: actorTypeValues,
    action: v.string(),
    resourceType: v.string(),
    resourceId: v.optional(v.string()),
    details: v.any(),
    riskLevel: riskLevelValues,
    traceId: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    return await ctx.db.insert('auditLogs', {
      organizationId: args.organizationId,
      userId: args.userId,
      actorType: args.actorType,
      action: args.action,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      details: args.details,
      riskLevel: args.riskLevel,
      traceId: args.traceId,
      ipAddress: args.ipAddress,
      createdAt: now,
    })
  },
})

export const appendBatch = internalMutation({
  args: {
    logs: v.array(
      v.object({
        organizationId: v.id('organizations'),
        userId: v.optional(v.id('appUsers')),
        actorType: actorTypeValues,
        action: v.string(),
        resourceType: v.string(),
        resourceId: v.optional(v.string()),
        details: v.any(),
        riskLevel: riskLevelValues,
        traceId: v.optional(v.string()),
        ipAddress: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const ids: Doc<'auditLogs'>['_id'][] = []

    for (const log of args.logs) {
      const id = await ctx.db.insert('auditLogs', {
        ...log,
        createdAt: now,
      })
      ids.push(id)
    }

    return ids
  },
})

export const list = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    action: v.optional(v.string()),
    riskLevel: v.optional(riskLevelValues),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)
    const pageSize = boundedPageSize(args.limit, DEFAULT_LIMIT, MAX_LIMIT)

    if (args.action) {
      const actionLogs = await ctx.db
        .query('auditLogs')
        .withIndex('by_org_action_created', (q) =>
          q.eq('organizationId', args.organizationId).eq('action', args.action as string)
        )
        .order('desc')
        .take(pageSize * 2)

      return args.riskLevel
        ? actionLogs.filter((log) => log.riskLevel === args.riskLevel).slice(0, pageSize)
        : actionLogs.slice(0, pageSize)
    }

    if (args.riskLevel) {
      return await ctx.db
        .query('auditLogs')
        .withIndex('by_org_risk_created', (q) =>
          q.eq('organizationId', args.organizationId).eq('riskLevel', args.riskLevel as any)
        )
        .order('desc')
        .take(pageSize)
    }

    return await ctx.db
      .query('auditLogs')
      .withIndex('by_org_created', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')
      .take(pageSize)
  },
})

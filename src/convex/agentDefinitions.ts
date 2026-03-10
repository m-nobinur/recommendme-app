import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { assertUserInOrganization } from './lib/auth'

const agentTypeValues = v.union(
  v.literal('followup'),
  v.literal('reminder'),
  v.literal('invoice'),
  v.literal('sales')
)

const triggerTypeValues = v.union(v.literal('cron'), v.literal('event'), v.literal('manual'))

const riskLevelValues = v.union(v.literal('low'), v.literal('medium'), v.literal('high'))

function assertUserCanManageAgents(user: Doc<'appUsers'>) {
  if (user.role !== 'owner' && user.role !== 'admin') {
    throw new Error('Only organization owners/admins can manage agents')
  }
}

export const create = mutation({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    agentType: agentTypeValues,
    enabled: v.boolean(),
    triggerType: triggerTypeValues,
    riskLevel: riskLevelValues,
    settings: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const user = await assertUserInOrganization(ctx, args.userId, args.organizationId)
    assertUserCanManageAgents(user)

    const existing = await ctx.db
      .query('agentDefinitions')
      .withIndex('by_org_agent', (q) =>
        q.eq('organizationId', args.organizationId).eq('agentType', args.agentType)
      )
      .first()

    if (existing) {
      throw new Error(`Agent definition '${args.agentType}' already exists for this organization`)
    }

    const now = Date.now()
    return await ctx.db.insert('agentDefinitions', {
      organizationId: args.organizationId,
      agentType: args.agentType,
      enabled: args.enabled,
      triggerType: args.triggerType,
      riskLevel: args.riskLevel,
      settings: args.settings,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const get = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    agentType: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    return await ctx.db
      .query('agentDefinitions')
      .withIndex('by_org_agent', (q) =>
        q.eq('organizationId', args.organizationId).eq('agentType', args.agentType)
      )
      .first()
  },
})

export const list = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    enabledOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const all = await ctx.db
      .query('agentDefinitions')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .take(100)

    if (args.enabledOnly) {
      return all.filter((d: Doc<'agentDefinitions'>) => d.enabled)
    }
    return all
  },
})

export const update = mutation({
  args: {
    userId: v.id('appUsers'),
    id: v.id('agentDefinitions'),
    organizationId: v.id('organizations'),
    enabled: v.optional(v.boolean()),
    triggerType: v.optional(triggerTypeValues),
    riskLevel: v.optional(riskLevelValues),
    settings: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const user = await assertUserInOrganization(ctx, args.userId, args.organizationId)
    assertUserCanManageAgents(user)

    const existing = await ctx.db.get(args.id)
    if (!existing || existing.organizationId !== args.organizationId) {
      throw new Error('Agent definition not found or access denied')
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() }
    if (args.enabled !== undefined) updates.enabled = args.enabled
    if (args.triggerType !== undefined) updates.triggerType = args.triggerType
    if (args.riskLevel !== undefined) updates.riskLevel = args.riskLevel
    if (args.settings !== undefined) updates.settings = args.settings

    await ctx.db.patch(args.id, updates)
    return { success: true }
  },
})

export const toggle = mutation({
  args: {
    userId: v.id('appUsers'),
    id: v.id('agentDefinitions'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const user = await assertUserInOrganization(ctx, args.userId, args.organizationId)
    assertUserCanManageAgents(user)

    const existing = await ctx.db.get(args.id)
    if (!existing || existing.organizationId !== args.organizationId) {
      throw new Error('Agent definition not found or access denied')
    }

    await ctx.db.patch(args.id, {
      enabled: !existing.enabled,
      updatedAt: Date.now(),
    })
    return { enabled: !existing.enabled }
  },
})

export const listEnabledByType = internalQuery({
  args: { agentType: agentTypeValues },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('agentDefinitions')
      .withIndex('by_agent_enabled', (q) => q.eq('agentType', args.agentType).eq('enabled', true))
      .take(100)
  },
})

export const getEnabledByOrgAndType = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    agentType: agentTypeValues,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('agentDefinitions')
      .withIndex('by_org_agent', (q) =>
        q.eq('organizationId', args.organizationId).eq('agentType', args.agentType)
      )
      .filter((q) => q.eq(q.field('enabled'), true))
      .first()
  },
})

export const ensureExists = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    agentType: agentTypeValues,
    triggerType: triggerTypeValues,
    riskLevel: riskLevelValues,
    settings: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('agentDefinitions')
      .withIndex('by_org_agent', (q) =>
        q.eq('organizationId', args.organizationId).eq('agentType', args.agentType)
      )
      .first()

    if (existing) return existing._id

    const now = Date.now()
    return await ctx.db.insert('agentDefinitions', {
      organizationId: args.organizationId,
      agentType: args.agentType,
      enabled: true,
      triggerType: args.triggerType,
      riskLevel: args.riskLevel,
      settings: args.settings,
      createdAt: now,
      updatedAt: now,
    })
  },
})

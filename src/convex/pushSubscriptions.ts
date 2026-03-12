import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { assertAuthenticatedUserInOrganization } from './lib/auth'

export const subscribe = mutation({
  args: {
    organizationId: v.id('organizations'),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const appUser = await assertAuthenticatedUserInOrganization(ctx, args.organizationId)
    if (!appUser) throw new Error('Not authenticated')

    const existing = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', args.endpoint))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        p256dh: args.p256dh,
        auth: args.auth,
        userAgent: args.userAgent,
      })
      return { subscriptionId: existing._id, updated: true }
    }

    const id = await ctx.db.insert('pushSubscriptions', {
      organizationId: args.organizationId,
      userId: appUser._id,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      userAgent: args.userAgent,
      createdAt: Date.now(),
    })

    return { subscriptionId: id, updated: false }
  },
})

export const unsubscribe = mutation({
  args: {
    organizationId: v.id('organizations'),
    endpoint: v.string(),
  },
  handler: async (ctx, args) => {
    await assertAuthenticatedUserInOrganization(ctx, args.organizationId)

    const existing = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', args.endpoint))
      .first()

    if (existing) {
      await ctx.db.delete(existing._id)
      return { removed: true }
    }
    return { removed: false }
  },
})

export const getMySubscription = query({
  args: {
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const appUser = await assertAuthenticatedUserInOrganization(ctx, args.organizationId)
    if (!appUser) return null

    const subs = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_user', (q) => q.eq('userId', appUser._id))
      .collect()

    return subs.length > 0 ? subs : null
  },
})

export const getByUser = internalQuery({
  args: {
    userId: v.id('appUsers'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .collect()
  },
})

export const getByOrg = internalQuery({
  args: {
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect()
  },
})

export const removeByEndpoint = internalQuery({
  args: {
    endpoint: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', args.endpoint))
      .first()
  },
})

export const removeStaleSubscriptions = internalMutation({
  args: {
    endpoints: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    let removed = 0
    for (const endpoint of args.endpoints) {
      const sub = await ctx.db
        .query('pushSubscriptions')
        .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
        .first()
      if (sub) {
        await ctx.db.delete(sub._id)
        removed++
      }
    }
    if (removed > 0) {
      console.log(`[PushDispatch] Removed ${removed} stale push subscriptions`)
    }
  },
})

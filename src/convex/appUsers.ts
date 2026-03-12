import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

/**
 * Get app user by ID
 */
export const getAppUser = query({
  args: { id: v.id('appUsers') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id)
  },
})

/**
 * Get app user by auth user ID
 */
export const getAppUserByAuthId = query({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('appUsers')
      .withIndex('by_auth_user', (q) => q.eq('authUserId', args.authUserId))
      .first()
  },
})

/**
 * Get app users by organization
 */
export const getAppUsersByOrganization = query({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('appUsers')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect()
  },
})

/**
 * Create or update app user (called after Better Auth creates a user)
 */
export const upsertAppUser = mutation({
  args: {
    authUserId: v.string(),
    organizationId: v.id('organizations'),
    role: v.optional(v.union(v.literal('owner'), v.literal('admin'), v.literal('member'))),
    settings: v.optional(
      v.object({
        aiProvider: v.optional(v.string()),
        modelTier: v.optional(v.string()),
        theme: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('appUsers')
      .withIndex('by_auth_user', (q) => q.eq('authUserId', args.authUserId))
      .first()

    const now = Date.now()

    if (existing) {
      // Update existing
      await ctx.db.patch(existing._id, {
        organizationId: args.organizationId,
        role: args.role || existing.role,
        settings: args.settings || existing.settings,
        updatedAt: now,
      })
      return existing._id
    } else {
      // Create new
      return await ctx.db.insert('appUsers', {
        authUserId: args.authUserId,
        organizationId: args.organizationId,
        role: args.role || 'member',
        settings: args.settings || {
          aiProvider: 'openrouter',
          modelTier: 'smart',
          theme: 'dark',
        },
        createdAt: now,
        updatedAt: now,
      })
    }
  },
})

/**
 * Get the first available app user (dev mode only).
 * Returns null in production to prevent data leakage.
 */
export const getDevAppUser = query({
  args: {},
  handler: async (ctx) => {
    if (process.env.NODE_ENV === 'production') return null
    return await ctx.db.query('appUsers').first()
  },
})

/**
 * Update app user settings
 */
export const updateAppUserSettings = mutation({
  args: {
    id: v.id('appUsers'),
    settings: v.object({
      aiProvider: v.optional(v.string()),
      modelTier: v.optional(v.string()),
      theme: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.id)
    if (!user) {
      throw new Error('App user not found')
    }

    await ctx.db.patch(args.id, {
      settings: {
        ...user.settings,
        ...args.settings,
      },
      updatedAt: Date.now(),
    })
  },
})

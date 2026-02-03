import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'

/**
 * Create a new organization
 */
export const createOrganization = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if slug is unique
    const existing = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first()

    if (existing) {
      throw new Error('Organization slug already exists')
    }

    const orgId = await ctx.db.insert('organizations', {
      name: args.name,
      slug: args.slug,
      createdAt: Date.now(),
      settings: {
        defaultAiProvider: 'openrouter',
        modelTier: 'smart',
      },
    })

    return orgId
  },
})

/**
 * Get organization by ID
 */
export const getOrganization = query({
  args: { id: v.id('organizations') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id)
  },
})

/**
 * Get organization by slug
 */
export const getOrganizationBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first()
  },
})

/**
 * Update organization settings
 */
export const updateOrganizationSettings = mutation({
  args: {
    id: v.id('organizations'),
    settings: v.object({
      defaultAiProvider: v.optional(v.string()),
      modelTier: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.id)
    if (!org) {
      throw new Error('Organization not found')
    }

    await ctx.db.patch(args.id, {
      settings: {
        ...org.settings,
        ...args.settings,
      },
    })
  },
})

/**
 * Internal: Create organization for new user signup
 */
export const internalCreateOrganization = internalMutation({
  args: {
    name: v.string(),
    userEmail: v.string(),
  },
  handler: async (ctx, args) => {
    // Generate slug from email
    const emailPrefix = args.userEmail.split('@')[0]
    const baseSlug = emailPrefix
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 30)

    // Ensure unique slug
    let slug = baseSlug
    let counter = 1
    while (true) {
      const existing = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', slug))
        .first()
      if (!existing) break
      slug = `${baseSlug}-${counter++}`
    }

    const orgId = await ctx.db.insert('organizations', {
      name: args.name,
      slug,
      createdAt: Date.now(),
      settings: {
        defaultAiProvider: 'openrouter',
        modelTier: 'smart',
      },
    })

    return orgId
  },
})

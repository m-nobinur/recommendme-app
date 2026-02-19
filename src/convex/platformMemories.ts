import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { internalMutation, query } from './_generated/server'

/**
 * Platform Memory CRUD (Top of Hierarchy)
 *
 * Admin-managed, read-only for tenants.
 * Contains universal best practices and proven patterns.
 *
 * Write operations use internalMutation to prevent public access.
 * Only internal functions (crons, actions, other mutations) can create/update/delete.
 * Read operations are public queries (platform knowledge is shared).
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  PLATFORM MEMORY                                                    │
 * │  ═════════════════════════                                          │
 * │                                                                     │
 * │  Scope:     Global (all tenants, all niches)                        │
 * │  Access:    Read: public queries | Write: internalMutation only     │
 * │  Populated: Admin curation, cross-tenant analytics (future)         │
 * │  PII:       FORBIDDEN (validated at input)                          │
 * │                                                                     │
 * │  Categories:                                                        │
 * │  ┌─────────────┬───────────────────────────────────────────────┐    │
 * │  │ sales       │ Closing techniques, objection handling        │    │
 * │  │ scheduling  │ Booking best practices, no-show prevention    │    │
 * │  │ pricing     │ Pricing psychology, discount strategies       │    │
 * │  │ communication│ Response tone, follow-up cadence             │    │
 * │  │ followup    │ Re-engagement patterns, timing rules          │    │
 * │  └─────────────┴───────────────────────────────────────────────┘    │
 * │                                                                     │
 * │  Position in retrieval:                                             │
 * │  Platform memories are the LOWEST priority in conflict resolution.  │
 * │  Business/Agent memories always override platform-level advice.     │
 * │                                                                     │
 * │         Platform (general)                                          │
 * │            ↓ overridden by                                          │
 * │         Niche (industry-specific)                                   │
 * │            ↓ overridden by                                          │
 * │         Business (org-specific)                                     │
 * │            ↓ overridden by                                          │
 * │         Agent (execution-specific)                                  │
 * └─────────────────────────────────────────────────────────────────────┘
 */

const platformCategoryValues = v.union(
  v.literal('sales'),
  v.literal('scheduling'),
  v.literal('pricing'),
  v.literal('communication'),
  v.literal('followup')
)

// ============================================
// CREATE (Internal only)
// ============================================

/**
 * Create a new platform memory (admin only)
 */
export const create = internalMutation({
  args: {
    category: platformCategoryValues,
    content: v.string(),
    confidence: v.float64(),
    sourceCount: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    const id = await ctx.db.insert('platformMemories', {
      category: args.category,
      content: args.content,
      confidence: args.confidence,
      sourceCount: args.sourceCount,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    return id
  },
})

// ============================================
// READ
// ============================================

/**
 * Get a single platform memory by ID
 */
export const get = query({
  args: { id: v.id('platformMemories') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id)
  },
})

/**
 * List platform memories with optional filters
 */
export const list = query({
  args: {
    category: v.optional(platformCategoryValues),
    activeOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 50, 100)
    const activeOnly = args.activeOnly ?? true

    let results: Doc<'platformMemories'>[] = []

    if (args.category && activeOnly) {
      const category = args.category
      results = await ctx.db
        .query('platformMemories')
        .withIndex('by_active_category', (q) => q.eq('isActive', true).eq('category', category))
        .order('desc')
        .take(pageSize)
    } else if (args.category) {
      const category = args.category
      results = await ctx.db
        .query('platformMemories')
        .withIndex('by_category', (q) => q.eq('category', category))
        .order('desc')
        .take(pageSize)
    } else if (activeOnly) {
      results = await ctx.db
        .query('platformMemories')
        .withIndex('by_active', (q) => q.eq('isActive', true))
        .order('desc')
        .take(pageSize)
    } else {
      results = await ctx.db.query('platformMemories').order('desc').take(pageSize)
    }

    return results
  },
})

// ============================================
// UPDATE
// ============================================

/**
 * Update a platform memory (admin only)
 */
export const update = internalMutation({
  args: {
    id: v.id('platformMemories'),
    content: v.optional(v.string()),
    category: v.optional(platformCategoryValues),
    confidence: v.optional(v.float64()),
    sourceCount: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    embedding: v.optional(v.array(v.float64())),
    validatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args
    const existing = await ctx.db.get(id)
    if (!existing) {
      throw new Error('Platform memory not found')
    }

    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, val]) => val !== undefined)
    )

    if (Object.keys(filteredUpdates).length > 0) {
      await ctx.db.patch(id, {
        ...filteredUpdates,
        updatedAt: Date.now(),
      })
    }

    return { success: true }
  },
})

// ============================================
// DELETE (Soft)
// ============================================

/**
 * Soft delete a platform memory (admin only)
 */
export const softDelete = internalMutation({
  args: { id: v.id('platformMemories') },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing) {
      throw new Error('Platform memory not found')
    }

    await ctx.db.patch(args.id, {
      isActive: false,
      updatedAt: Date.now(),
    })

    return { success: true }
  },
})

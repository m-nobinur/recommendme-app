import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { internalMutation, query } from './_generated/server'

/**
 * Niche Memory CRUD (Industry Vertical)
 *
 * Shared within industry vertical.
 * Contains industry terminology, service patterns, pricing norms.
 * Filtered by nicheId for isolation.
 *
 * Write operations use internalMutation (populated by platform pipelines).
 * Read operations are public queries (niche knowledge is shared with tenants).
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  LAYER 2: NICHE MEMORY                                              │
 * │  ═════════════════════════                                          │
 * │                                                                     │
 * │  Scope:     Per industry vertical (nicheId)                         │
 * │  Access:    Read: public queries | Write: internalMutation only     │
 * │  Populated: Aggregated from successful business patterns            │
 * │  PII:       Should be redacted (warning, not blocking)              │
 * │                                                                     │
 * │  nicheId examples: 'photography', 'plumbing', 'real-estate'         │
 * │                                                                     │
 * │  How niches share knowledge:                                        │
 * │                                                                     │
 * │  Org A (photographer) ──┐                                           │
 * │  Org B (photographer) ──┼──> nicheId:'photography'                  │
 * │  Org C (photographer) ──┘    "Wedding sessions avg $2,500"          │
 * │                              "Peak season: May-October"             │
 * │                                                                     │
 * │  Org D (plumber) ──────────> nicheId:'plumbing'                     │
 * │  Org E (plumber) ──────────> "Emergency calls need 1-hour window"   │
 * │                                                                     │
 * │  Vector search is filtered by nicheId so a plumber never            │
 * │  retrieves photography-specific memories.                           │
 * └─────────────────────────────────────────────────────────────────────┘
 */

/**
 * Create a new niche memory
 */
export const create = internalMutation({
  args: {
    nicheId: v.string(),
    category: v.string(),
    content: v.string(),
    confidence: v.float64(),
    contributorCount: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    const id = await ctx.db.insert('nicheMemories', {
      nicheId: args.nicheId,
      category: args.category,
      content: args.content,
      confidence: args.confidence,
      contributorCount: args.contributorCount,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.scheduler.runAfter(0, internal.embedding.generateAndStore, {
      tableName: 'nicheMemories' as const,
      documentId: id,
      content: args.content,
    })

    return id
  },
})

/**
 * Get a single niche memory by ID
 */
export const get = query({
  args: {
    id: v.id('nicheMemories'),
    nicheId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.id)
    if (memory && args.nicheId && memory.nicheId !== args.nicheId) {
      return null
    }
    return memory
  },
})

/**
 * List niche memories for a specific niche
 *
 * Uses index-based filtering to avoid post-query JS filtering
 * which would return fewer results than the requested limit.
 */
export const list = query({
  args: {
    nicheId: v.string(),
    category: v.optional(v.string()),
    activeOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 50, 100)
    const activeOnly = args.activeOnly ?? true

    let results: Doc<'nicheMemories'>[] = []

    if (activeOnly && args.category) {
      const category = args.category
      const candidates = await ctx.db
        .query('nicheMemories')
        .withIndex('by_niche_category', (q) =>
          q.eq('nicheId', args.nicheId).eq('category', category)
        )
        .order('desc')
        .take(pageSize * 3)

      results = candidates.filter((m) => m.isActive).slice(0, pageSize)
    } else if (activeOnly) {
      results = await ctx.db
        .query('nicheMemories')
        .withIndex('by_niche_active', (q) => q.eq('nicheId', args.nicheId).eq('isActive', true))
        .order('desc')
        .take(pageSize)
    } else if (args.category) {
      const category = args.category
      results = await ctx.db
        .query('nicheMemories')
        .withIndex('by_niche_category', (q) =>
          q.eq('nicheId', args.nicheId).eq('category', category)
        )
        .order('desc')
        .take(pageSize)
    } else {
      results = await ctx.db
        .query('nicheMemories')
        .withIndex('by_niche', (q) => q.eq('nicheId', args.nicheId))
        .order('desc')
        .take(pageSize)
    }

    return results
  },
})

/**
 * Update a niche memory (internal - admin/pipeline only)
 */
export const update = internalMutation({
  args: {
    id: v.id('nicheMemories'),
    content: v.optional(v.string()),
    category: v.optional(v.string()),
    confidence: v.optional(v.float64()),
    contributorCount: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args
    const existing = await ctx.db.get(id)
    if (!existing) {
      throw new Error('Niche memory not found')
    }

    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, val]) => val !== undefined)
    )

    const contentChanged = updates.content !== undefined

    if (Object.keys(filteredUpdates).length > 0) {
      await ctx.db.patch(id, {
        ...filteredUpdates,
        updatedAt: Date.now(),
      })
    }

    if (contentChanged && updates.content) {
      await ctx.scheduler.runAfter(0, internal.embedding.generateAndStore, {
        tableName: 'nicheMemories' as const,
        documentId: id,
        content: updates.content,
      })
    }

    return { success: true }
  },
})

/**
 * Soft delete a niche memory (internal - admin/pipeline only)
 */
export const softDelete = internalMutation({
  args: { id: v.id('nicheMemories') },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing) {
      throw new Error('Niche memory not found')
    }

    await ctx.db.patch(args.id, {
      isActive: false,
      updatedAt: Date.now(),
    })

    return { success: true }
  },
})

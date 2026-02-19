import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

/**
 * Memory Relations CRUD (Knowledge Graph Edges)
 *
 * Graph connecting entities within an organization.
 * All operations enforce organizationId for strict tenant isolation.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                    KNOWLEDGE GRAPH MODEL                            │
 * │                                                                     │
 * │  Entities (nodes) are referenced by type + id:                      │
 * │    sourceType: 'lead' | 'memory' | 'service' | 'appointment' | ...  │
 * │    sourceId:   the entity's _id as string                           │
 * │                                                                     │
 * │  Example Graph for a Photography Business:                          │
 * │                                                                     │
 * │    [Lead: Sarah] ──prefers──> [Service: Portrait Session]           │
 * │         │                          │                                │
 * │         │                     requires                              │
 * │         │                          v                                │
 * │    leads_to               [Service: Studio Rental]                  │
 * │         │                                                           │
 * │         v                                                           │
 * │    [Memory: "Sarah always books weekends"]                          │
 * │         │                                                           │
 * │    related_to                                                       │
 * │         v                                                           │
 * │    [Memory: "Weekend bookings need 48hr notice"]                    │
 * │                                                                     │
 * │  Relation Types & Their Semantics:                                  │
 * │  ─────────────────────────────────────────────                      │
 * │  prefers        A chooses B over alternatives  (strength: 0-1)      │
 * │  related_to     A and B are contextually linked (strength: 0-1)     │
 * │  leads_to       A typically results in B        (strength: 0-1)     │
 * │  requires       A cannot happen without B       (strength: 0-1)     │
 * │  conflicts_with A and B are incompatible        (strength: 0-1)     │
 * │                                                                     │
 * │  Querying Patterns:                                                 │
 * │  ─────────────────                                                  │
 * │  getBySource  -> "What does entity X relate TO?"                    │
 * │  getByTarget  -> "What relates TO entity X?"                        │
 * │  getForEntity -> "All connections for entity X" (both directions)   │
 * │                                                                     │
 * │  Index Design:                                                      │
 * │  ─────────────                                                      │
 * │  by_source: [orgId, sourceType, sourceId] -> outbound edges         │
 * │  by_target: [orgId, targetType, targetId] -> inbound edges          │
 * │  by_org:    [orgId]                       -> all edges in tenant    │
 * └─────────────────────────────────────────────────────────────────────┘
 */

/** Maximum number of relations to return in a single query */
const MAX_RELATIONS_PER_QUERY = 200

const relationTypeValues = v.union(
  v.literal('prefers'),
  v.literal('related_to'),
  v.literal('leads_to'),
  v.literal('requires'),
  v.literal('conflicts_with')
)

// ============================================
// CREATE
// ============================================

/**
 * Create a new memory relation (graph edge, tenant-scoped)
 */
export const create = mutation({
  args: {
    organizationId: v.id('organizations'),
    sourceType: v.string(),
    sourceId: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    relationType: relationTypeValues,
    strength: v.float64(),
    evidence: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    const id = await ctx.db.insert('memoryRelations', {
      organizationId: args.organizationId,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      targetType: args.targetType,
      targetId: args.targetId,
      relationType: args.relationType,
      strength: args.strength,
      evidence: args.evidence,
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
 * Get a single memory relation by ID (tenant-scoped)
 */
export const get = query({
  args: {
    id: v.id('memoryRelations'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const relation = await ctx.db.get(args.id)
    if (!relation || relation.organizationId !== args.organizationId) {
      return null
    }
    return relation
  },
})

/**
 * List all relations for an organization
 */
export const list = query({
  args: {
    organizationId: v.id('organizations'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 50, MAX_RELATIONS_PER_QUERY)

    return await ctx.db
      .query('memoryRelations')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')
      .take(pageSize)
  },
})

/**
 * Get all relations from a specific source entity (bounded)
 */
export const getBySource = query({
  args: {
    organizationId: v.id('organizations'),
    sourceType: v.string(),
    sourceId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 50, MAX_RELATIONS_PER_QUERY)

    return await ctx.db
      .query('memoryRelations')
      .withIndex('by_source', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('sourceType', args.sourceType)
          .eq('sourceId', args.sourceId)
      )
      .order('desc')
      .take(pageSize)
  },
})

/**
 * Get all relations targeting a specific entity (bounded)
 */
export const getByTarget = query({
  args: {
    organizationId: v.id('organizations'),
    targetType: v.string(),
    targetId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 50, MAX_RELATIONS_PER_QUERY)

    return await ctx.db
      .query('memoryRelations')
      .withIndex('by_target', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('targetType', args.targetType)
          .eq('targetId', args.targetId)
      )
      .order('desc')
      .take(pageSize)
  },
})

/**
 * Get all relations for a specific entity (both source and target, bounded).
 */
export const getForEntity = query({
  args: {
    organizationId: v.id('organizations'),
    entityType: v.string(),
    entityId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 50, MAX_RELATIONS_PER_QUERY)

    const [asSource, asTarget] = await Promise.all([
      ctx.db
        .query('memoryRelations')
        .withIndex('by_source', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('sourceType', args.entityType)
            .eq('sourceId', args.entityId)
        )
        .order('desc')
        .take(pageSize),
      ctx.db
        .query('memoryRelations')
        .withIndex('by_target', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('targetType', args.entityType)
            .eq('targetId', args.entityId)
        )
        .order('desc')
        .take(pageSize),
    ])

    return { asSource, asTarget }
  },
})

// ============================================
// UPDATE
// ============================================

/**
 * Update a memory relation (tenant-scoped)
 */
export const update = mutation({
  args: {
    id: v.id('memoryRelations'),
    organizationId: v.id('organizations'),
    relationType: v.optional(relationTypeValues),
    strength: v.optional(v.float64()),
    evidence: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, organizationId, ...updates } = args
    const existing = await ctx.db.get(id)

    if (!existing || existing.organizationId !== organizationId) {
      throw new Error('Memory relation not found or access denied')
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
// DELETE
// ============================================

/**
 * Delete a memory relation (hard delete, tenant-scoped).
 * Graph edges are not soft-deleted.
 */
export const remove = mutation({
  args: {
    id: v.id('memoryRelations'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing || existing.organizationId !== args.organizationId) {
      throw new Error('Memory relation not found or access denied')
    }

    await ctx.db.delete(args.id)
    return { success: true }
  },
})

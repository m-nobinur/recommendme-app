import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { internalMutation, mutation, query } from './_generated/server'
import { validateBusinessMemoryInput } from './memoryValidation'

/**
 * Business Memory CRUD (Organization-Specific)
 *
 * Per organization, tenant-isolated.
 * Contains customer prefs, pricing, services, communication style.
 * All operations enforce organizationId for strict tenant isolation.
 *
 * Public mutations require organizationId for tenant scoping.
 * Internal mutations are used for pipeline/worker operations.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  BUSINESS MEMORY                                                    │
 * │  ═════════════════════════                                          │
 * │                                                                     │
 * │  Scope:     Per organization (strict orgId isolation)               │
 * │  Access:    Read/Write: public mutations | recordAccess: internal   │
 * │  Populated: Extraction pipeline (from conversations & actions)      │
 * │  PII:       Allowed (encrypted at rest)                             │
 * │                                                                     │
 * │  Memory Types & Examples:                                           │
 * │  ┌──────────────┬──────────────────────────────────────────────┐    │
 * │  │ fact         │ "Sarah's wedding is June 15th"               │    │
 * │  │ preference   │ "Client prefers email over phone"            │    │
 * │  │ instruction  │ "Always include travel fee for 20mi+"        │    │
 * │  │ context      │ "Currently running a holiday promo"          │    │
 * │  │ relationship │ "Sarah referred by Mike (lead #42)"          │    │
 * │  │ episodic     │ "Last call: discussed pricing for headshots" │    │
 * │  └──────────────┴──────────────────────────────────────────────┘    │
 * │                                                                     │
 * │  Lifecycle:                                                         │
 * │  ──────────                                                         │
 * │  1. Created by extraction pipeline  (version: 1, decayScore: 1.0)   │
 * │  2. Accessed during retrieval       (accessCount++, decay resets)   │
 * │  3. Updated if contradicted         (version++, previousVersionId)  │
 * │  4. Decays over time if unused      (decayScore drops toward 0)     │
 * │  5. Archived when superseded        (isArchived: true)              │
 * │  6. Soft-deleted when irrelevant    (isActive: false)               │
 * │                                                                     │
 * │  Subject Linking:                                                   │
 * │  ────────────────                                                   │
 * │  Memories can link to CRM entities via subjectType + subjectId:     │
 * │    { subjectType: 'lead', subjectId: 'j97abc...' }                  │
 * │    { subjectType: 'appointment', subjectId: 'k83def...' }           │
 * │    { subjectType: 'service', subjectId: 'portrait-session' }        │
 * │                                                                     │
 * │  This enables queries like: "What do we know about lead Sarah?"     │
 * │  using the by_org_subject index.                                    │
 * └─────────────────────────────────────────────────────────────────────┘
 */

// TTL defaults (mirrored from src/lib/memory/ttl.ts for Convex runtime)
const MS_PER_DAY = 86_400_000
const DEFAULT_TTL_DAYS: Record<string, number | null> = {
  fact: 180,
  preference: 90,
  instruction: null,
  context: 30,
  relationship: 180,
  episodic: 90,
}
function computeExpiresAt(type: string, createdAt: number): number | undefined {
  const days = DEFAULT_TTL_DAYS[type]
  if (days === null || days === undefined) return undefined
  return createdAt + days * MS_PER_DAY
}

const businessMemoryTypeValues = v.union(
  v.literal('fact'),
  v.literal('preference'),
  v.literal('instruction'),
  v.literal('context'),
  v.literal('relationship'),
  v.literal('episodic')
)

const memorySourceValues = v.union(
  v.literal('extraction'),
  v.literal('explicit'),
  v.literal('tool'),
  v.literal('system')
)

/**
 * Create a new business memory (tenant-scoped)
 */
export const create = mutation({
  args: {
    organizationId: v.id('organizations'),
    userId: v.optional(v.string()),
    type: businessMemoryTypeValues,
    content: v.string(),
    subjectType: v.optional(v.string()),
    subjectId: v.optional(v.string()),
    importance: v.float64(),
    confidence: v.float64(),
    source: memorySourceValues,
    sourceMessageId: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    validateBusinessMemoryInput({
      content: args.content,
      confidence: args.confidence,
      importance: args.importance,
    })

    const now = Date.now()

    const id = await ctx.db.insert('businessMemories', {
      organizationId: args.organizationId,
      userId: args.userId,
      type: args.type,
      content: args.content,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      importance: args.importance,
      confidence: args.confidence,
      decayScore: 1.0,
      accessCount: 0,
      lastAccessedAt: now,
      source: args.source,
      sourceMessageId: args.sourceMessageId,
      expiresAt: args.expiresAt ?? computeExpiresAt(args.type, now),
      isActive: true,
      isArchived: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.scheduler.runAfter(0, internal.embedding.generateAndStore, {
      tableName: 'businessMemories' as const,
      documentId: id,
      content: args.content,
      organizationId: args.organizationId,
    })

    return id
  },
})

/**
 * Get a single business memory by ID (tenant-scoped)
 */
export const get = query({
  args: {
    id: v.id('businessMemories'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.id)
    if (!memory || memory.organizationId !== args.organizationId) {
      return null
    }
    return memory
  },
})

/**
 * List business memories for an organization.
 */
export const list = query({
  args: {
    organizationId: v.id('organizations'),
    type: v.optional(businessMemoryTypeValues),
    subjectType: v.optional(v.string()),
    subjectId: v.optional(v.string()),
    activeOnly: v.optional(v.boolean()),
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 50, 100)
    const activeOnly = args.activeOnly ?? true
    const includeArchived = args.includeArchived ?? false

    let results: Doc<'businessMemories'>[] = []

    if (args.subjectType && args.subjectId) {
      const subjectType = args.subjectType
      const subjectId = args.subjectId
      const candidates = await ctx.db
        .query('businessMemories')
        .withIndex('by_org_subject', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('subjectType', subjectType)
            .eq('subjectId', subjectId)
        )
        .order('desc')
        .take(activeOnly ? pageSize * 3 : pageSize)

      results = activeOnly ? candidates.filter((m) => m.isActive) : candidates
    } else if (args.type) {
      const memoryType = args.type
      const candidates = await ctx.db
        .query('businessMemories')
        .withIndex('by_org_type', (q) =>
          q.eq('organizationId', args.organizationId).eq('type', memoryType)
        )
        .order('desc')
        .take(activeOnly ? pageSize * 3 : pageSize)

      results = activeOnly ? candidates.filter((m) => m.isActive) : candidates
    } else if (activeOnly) {
      results = await ctx.db
        .query('businessMemories')
        .withIndex('by_org_active', (q) =>
          q.eq('organizationId', args.organizationId).eq('isActive', true)
        )
        .order('desc')
        .take(pageSize)
    } else {
      results = await ctx.db
        .query('businessMemories')
        .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
        .order('desc')
        .take(pageSize)
    }

    if (!includeArchived) {
      results = results.filter((m) => !m.isArchived)
    }

    return results.slice(0, pageSize)
  },
})

/**
 * List active business memories sorted by importance (for context retrieval).
 */
export const listByImportance = query({
  args: {
    organizationId: v.id('organizations'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 20, 100)

    const candidates = await ctx.db
      .query('businessMemories')
      .withIndex('by_org_importance', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')
      .take(pageSize * 3)

    return candidates.filter((m) => m.isActive && !m.isArchived).slice(0, pageSize)
  },
})

/**
 * Update a business memory with version history (tenant-scoped)
 */
export const update = mutation({
  args: {
    id: v.id('businessMemories'),
    organizationId: v.id('organizations'),
    content: v.optional(v.string()),
    type: v.optional(businessMemoryTypeValues),
    subjectType: v.optional(v.string()),
    subjectId: v.optional(v.string()),
    importance: v.optional(v.float64()),
    confidence: v.optional(v.float64()),
    decayScore: v.optional(v.float64()),
    isActive: v.optional(v.boolean()),
    isArchived: v.optional(v.boolean()),
    embedding: v.optional(v.array(v.float64())),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, organizationId, ...updates } = args
    const existing = await ctx.db.get(id)

    if (!existing || existing.organizationId !== organizationId) {
      throw new Error('Business memory not found or access denied')
    }

    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, val]) => val !== undefined)
    )

    const newVersion = updates.content !== undefined ? existing.version + 1 : existing.version
    const contentChanged = updates.content !== undefined

    if (Object.keys(filteredUpdates).length > 0) {
      await ctx.db.patch(id, {
        ...filteredUpdates,
        version: newVersion,
        previousVersionId: contentChanged ? existing._id : existing.previousVersionId,
        updatedAt: Date.now(),
      })
    }

    if (contentChanged && updates.content) {
      await ctx.scheduler.runAfter(0, internal.embedding.generateAndStore, {
        tableName: 'businessMemories' as const,
        documentId: id,
        content: updates.content,
        organizationId,
      })
    }

    return { success: true, version: newVersion }
  },
})

/**
 * Increment access count and update last accessed timestamp.
 * Used during memory retrieval to track usage.
 * Schedules an immediate decay boost so the score reflects the access.
 */
export const recordAccess = internalMutation({
  args: {
    id: v.id('businessMemories'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing || existing.organizationId !== args.organizationId) {
      return { success: false }
    }

    await ctx.db.patch(args.id, {
      accessCount: existing.accessCount + 1,
      lastAccessedAt: Date.now(),
    })

    await ctx.scheduler.runAfter(0, internal.memoryDecay.boostBusinessDecayOnAccess, {
      id: args.id,
      organizationId: args.organizationId,
    })

    return { success: true }
  },
})

/**
 * Soft delete a business memory (set isActive = false, tenant-scoped)
 */
export const softDelete = mutation({
  args: {
    id: v.id('businessMemories'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing || existing.organizationId !== args.organizationId) {
      throw new Error('Business memory not found or access denied')
    }

    await ctx.db.patch(args.id, {
      isActive: false,
      updatedAt: Date.now(),
    })

    return { success: true }
  },
})

/**
 * Archive a business memory (set isArchived = true, tenant-scoped)
 */
export const archive = mutation({
  args: {
    id: v.id('businessMemories'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing || existing.organizationId !== args.organizationId) {
      throw new Error('Business memory not found or access denied')
    }

    await ctx.db.patch(args.id, {
      isArchived: true,
      updatedAt: Date.now(),
    })

    return { success: true }
  },
})

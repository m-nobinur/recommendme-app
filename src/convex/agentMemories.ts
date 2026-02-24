import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { internalMutation, mutation, query } from './_generated/server'
import { validateAgentMemoryInput } from './memoryValidation'

/**
 * Agent Memory CRUD (Execution-Level)
 *
 * Per agent type per organization.
 * Contains execution patterns, learned preferences, success/failure records.
 * Filtered by organizationId + agentType for isolation.
 *
 * Public mutations require organizationId for tenant scoping.
 * Internal mutations for pipeline/worker operations (recordUse).
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  LAYER 4: AGENT MEMORY                                              │
 * │  ═════════════════════════                                          │
 * │                                                                     │
 * │  Scope:     Per agent type per org (orgId + agentType)              │
 * │  Access:    Read/Write: public | recordUse: internal                │
 * │  Populated: Agent execution outcomes (post-action learning)         │
 * │  PII:       Should be redacted (warning, not blocking)              │
 * │                                                                     │
 * │  Agent Types & What They Learn:                                     │
 * │  ┌───────────┬─────────────────────────────────────────────────┐    │
 * │  │ crm       │ "Leads respond better to follow-ups on Tuesday" │    │
 * │  │ followup  │ "9am reminder emails get 3x open rate"          │    │
 * │  │ invoice   │ "Net-15 terms convert better than Net-30"       │    │
 * │  │ sales     │ "Mentioning portfolio increases booking by 40%" │    │
 * │  │ reminder  │ "SMS reminders 2hrs before reduce no-shows"     │    │
 * │  └───────────┴─────────────────────────────────────────────────┘    │
 * │                                                                     │
 * │  Categories:                                                        │
 * │  ┌────────────┬────────────────────────────────────────────────┐    │
 * │  │ pattern    │ Recurring behavior observed across executions  │    │
 * │  │ preference │ Learned agent configuration (tone, timing)     │    │
 * │  │ success    │ Action that led to positive outcome            │    │
 * │  │ failure    │ Action that failed (avoid repeating)           │    │
 * │  └────────────┴────────────────────────────────────────────────┘    │
 * │                                                                     │
 * │  Learning Loop:                                                     │
 * │  ──────────────                                                     │
 * │  1. Agent executes action                                           │
 * │  2. Outcome recorded as memoryEvent (tool_success / tool_failure)   │
 * │  3. Pipeline extracts pattern -> agentMemory created                │
 * │  4. On next execution, agent retrieves relevant memories            │
 * │  5. recordUse() tracks usage + updates successRate                  │
 * │                                                                     │
 * │  Success Rate Calculation (running average):                        │
 * │  newRate = (oldRate * oldCount + (success ? 1 : 0)) / newCount      │
 * │                                                                     │
 * │  Agent memories have HIGHEST priority in retrieval -                │
 * │  they override platform, niche, and business memories.              │
 * └─────────────────────────────────────────────────────────────────────┘
 */

const agentCategoryValues = v.union(
  v.literal('pattern'),
  v.literal('preference'),
  v.literal('success'),
  v.literal('failure')
)

// ============================================
// CREATE
// ============================================

/**
 * Create a new agent memory (tenant-scoped)
 */
export const create = mutation({
  args: {
    organizationId: v.id('organizations'),
    agentType: v.string(),
    category: agentCategoryValues,
    content: v.string(),
    confidence: v.float64(),
  },
  handler: async (ctx, args) => {
    validateAgentMemoryInput({
      content: args.content,
      confidence: args.confidence,
    })

    const now = Date.now()

    const id = await ctx.db.insert('agentMemories', {
      organizationId: args.organizationId,
      agentType: args.agentType,
      category: args.category,
      content: args.content,
      confidence: args.confidence,
      useCount: 0,
      successRate: 0.0,
      decayScore: 1.0,
      lastUsedAt: now,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.scheduler.runAfter(0, internal.embedding.generateAndStore, {
      tableName: 'agentMemories' as const,
      documentId: id,
      content: args.content,
    })

    return id
  },
})

// ============================================
// READ
// ============================================

/**
 * Get a single agent memory by ID (tenant-scoped)
 */
export const get = query({
  args: {
    id: v.id('agentMemories'),
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
 * List agent memories for a specific agent type within an organization.
 */
export const list = query({
  args: {
    organizationId: v.id('organizations'),
    agentType: v.string(),
    category: v.optional(agentCategoryValues),
    activeOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 50, 100)
    const activeOnly = args.activeOnly ?? true

    let results: Doc<'agentMemories'>[] = []

    if (args.category && activeOnly) {
      const category = args.category
      const candidates = await ctx.db
        .query('agentMemories')
        .withIndex('by_org_agent_category', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('agentType', args.agentType)
            .eq('category', category)
        )
        .order('desc')
        .take(pageSize * 3)

      results = candidates.filter((m) => m.isActive).slice(0, pageSize)
    } else if (args.category) {
      const category = args.category
      results = await ctx.db
        .query('agentMemories')
        .withIndex('by_org_agent_category', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('agentType', args.agentType)
            .eq('category', category)
        )
        .order('desc')
        .take(pageSize)
    } else if (activeOnly) {
      results = await ctx.db
        .query('agentMemories')
        .withIndex('by_org_agent_active', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('agentType', args.agentType)
            .eq('isActive', true)
        )
        .order('desc')
        .take(pageSize)
    } else {
      results = await ctx.db
        .query('agentMemories')
        .withIndex('by_org_agent', (q) =>
          q.eq('organizationId', args.organizationId).eq('agentType', args.agentType)
        )
        .order('desc')
        .take(pageSize)
    }

    return results
  },
})

// ============================================
// UPDATE
// ============================================

/**
 * Update an agent memory (tenant-scoped)
 */
export const update = mutation({
  args: {
    id: v.id('agentMemories'),
    organizationId: v.id('organizations'),
    content: v.optional(v.string()),
    category: v.optional(agentCategoryValues),
    confidence: v.optional(v.float64()),
    decayScore: v.optional(v.float64()),
    isActive: v.optional(v.boolean()),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const { id, organizationId, ...updates } = args
    const existing = await ctx.db.get(id)

    if (!existing || existing.organizationId !== organizationId) {
      throw new Error('Agent memory not found or access denied')
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
        tableName: 'agentMemories' as const,
        documentId: id,
        content: updates.content,
      })
    }

    return { success: true }
  },
})

/**
 * Record a use of this agent memory and update success tracking.
 * Internal since it is called by the agent execution pipeline, not end users.
 */
export const recordUse = internalMutation({
  args: {
    id: v.id('agentMemories'),
    organizationId: v.id('organizations'),
    wasSuccessful: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing || existing.organizationId !== args.organizationId) {
      return { success: false }
    }

    const newUseCount = existing.useCount + 1
    const newSuccessRate =
      (existing.successRate * existing.useCount + (args.wasSuccessful ? 1 : 0)) / newUseCount

    await ctx.db.patch(args.id, {
      useCount: newUseCount,
      successRate: newSuccessRate,
      lastUsedAt: Date.now(),
      updatedAt: Date.now(),
    })

    return { success: true, useCount: newUseCount, successRate: newSuccessRate }
  },
})

// ============================================
// DELETE (Soft)
// ============================================

/**
 * Soft delete an agent memory (set isActive = false, tenant-scoped)
 */
export const softDelete = mutation({
  args: {
    id: v.id('agentMemories'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing || existing.organizationId !== args.organizationId) {
      throw new Error('Agent memory not found or access denied')
    }

    await ctx.db.patch(args.id, {
      isActive: false,
      updatedAt: Date.now(),
    })

    return { success: true }
  },
})

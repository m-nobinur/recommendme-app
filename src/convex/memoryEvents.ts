import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'

/**
 * Memory Events CRUD (Pipeline Trigger Queue)
 *
 * Drives async memory extraction and processing.
 * Events are created when significant actions occur and processed
 * by background workers to extract and store memories.
 *
 * Create is a public mutation (triggered from chat flow with tenant context).
 * Processing operations (markProcessed, markBatchProcessed) are internal
 * since they are invoked by background workers/crons.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                   EVENT-DRIVEN MEMORY PIPELINE                      │
 * │                                                                     │
 * │  Trigger Sources:                                                   │
 * │  ────────────────                                                   │
 * │  User sends message ──> conversation_end (after chat completes)     │
 * │  Agent calls tool   ──> tool_success / tool_failure                 │
 * │  User corrects AI   ──> user_correction                             │
 * │  User gives rule    ──> explicit_instruction                        │
 * │  User approves plan ──> approval_granted / approval_rejected        │
 * │  User rates reply   ──> feedback                                    │
 * │                                                                     │
 * │  Processing Flow (FIFO):                                            │
 * │  ──────────────────────                                             │
 * │                                                                     │
 * │  ┌──────────┐   create()   ┌──────────────┐   worker picks up       │
 * │  │ Chat /   │ ──────────>  │ memoryEvents │ ───────────────────>    │
 * │  │ Agent    │              │ (unprocessed)│    (cron or action)     │
 * │  └──────────┘              └──────────────┘                         │
 * │                                    │                                │
 * │                                    v                                │
 * │                          ┌─────────────────┐                        │
 * │                          │ Extraction       │                       │
 * │                          │ Pipeline         │                       │
 * │                          │ (LLM-powered)    │                       │
 * │                          └─────────────────┘                        │
 * │                            │       │       │                        │
 * │                            v       v       v                        │
 * │                     ┌────────┐ ┌────────┐ ┌──────────┐              │
 * │                     │Business│ │Agent   │ │Memory    │              │
 * │                     │Memory  │ │Memory  │ │Relations │              │
 * │                     └────────┘ └────────┘ └──────────┘              │
 * │                                                                     │
 * │                          markProcessed()                            │
 * │                          markBatchProcessed()                       │
 * │                                                                     │
 * │  Query Patterns:                                                    │
 * │  ───────────────                                                    │
 * │  listUnprocessed -> Worker picks up next batch (FIFO, oldest first) │
 * │  listByType      -> Type-specific workers (e.g., only tool_failure) │
 * │  listRecent      -> Dashboard monitoring (newest first)             │
 * └─────────────────────────────────────────────────────────────────────┘
 */

/** Maximum batch size for batch operations */
const MAX_BATCH_SIZE = 50

const eventTypeValues = v.union(
  v.literal('conversation_end'),
  v.literal('tool_success'),
  v.literal('tool_failure'),
  v.literal('user_correction'),
  v.literal('explicit_instruction'),
  v.literal('approval_granted'),
  v.literal('approval_rejected'),
  v.literal('feedback')
)

const eventSourceTypeValues = v.union(
  v.literal('message'),
  v.literal('tool_call'),
  v.literal('agent_action')
)

// ============================================
// CREATE
// ============================================

/**
 * Create a new memory event (tenant-scoped)
 */
const memoryEventData = v.union(
  v.object({
    type: v.literal('conversation_end'),
    conversationId: v.string(),
    messageCount: v.number(),
    lastUserMessage: v.optional(v.string()),
    finishReason: v.string(),
    latencyMs: v.optional(v.number()),
  }),
  v.object({
    type: v.literal('tool_result'),
    toolName: v.string(),
    args: v.optional(v.string()),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  }),
  v.object({
    type: v.literal('user_input'),
    content: v.string(),
    originalContent: v.optional(v.string()),
  }),
  v.object({
    type: v.literal('approval'),
    actionDescription: v.string(),
    approved: v.boolean(),
    reason: v.optional(v.string()),
  }),
  v.object({
    type: v.literal('feedback'),
    rating: v.optional(v.number()),
    comment: v.optional(v.string()),
    messageId: v.optional(v.string()),
  })
)

export const create = mutation({
  args: {
    organizationId: v.id('organizations'),
    eventType: eventTypeValues,
    sourceType: eventSourceTypeValues,
    sourceId: v.string(),
    data: memoryEventData,
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('memoryEvents', {
      organizationId: args.organizationId,
      eventType: args.eventType,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      data: args.data,
      processed: false,
      createdAt: Date.now(),
    })

    return id
  },
})

// ============================================
// READ
// ============================================

/**
 * Get a single memory event by ID (tenant-scoped)
 */
export const get = query({
  args: {
    id: v.id('memoryEvents'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.id)
    if (!event || event.organizationId !== args.organizationId) {
      return null
    }
    return event
  },
})

/**
 * List unprocessed events for an organization (for workers to process, FIFO)
 */
export const listUnprocessed = query({
  args: {
    organizationId: v.id('organizations'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 10, 100)

    return await ctx.db
      .query('memoryEvents')
      .withIndex('by_org_unprocessed', (q) =>
        q.eq('organizationId', args.organizationId).eq('processed', false)
      )
      .order('asc')
      .take(pageSize)
  },
})

/**
 * Internal version of listUnprocessed for the extraction worker.
 */
export const listUnprocessedInternal = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 10, 100)

    return await ctx.db
      .query('memoryEvents')
      .withIndex('by_org_unprocessed', (q) =>
        q.eq('organizationId', args.organizationId).eq('processed', false)
      )
      .order('asc')
      .take(pageSize)
  },
})

/**
 * List events by type (for type-specific workers)
 */
export const listByType = query({
  args: {
    eventType: eventTypeValues,
    processedOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 10, 100)
    const processed = args.processedOnly ?? false

    return await ctx.db
      .query('memoryEvents')
      .withIndex('by_type', (q) => q.eq('eventType', args.eventType).eq('processed', processed))
      .order('asc')
      .take(pageSize)
  },
})

/**
 * List recent events for an organization (for monitoring, newest first)
 */
export const listRecent = query({
  args: {
    organizationId: v.id('organizations'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 20, 100)

    return await ctx.db
      .query('memoryEvents')
      .withIndex('by_org_created', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')
      .take(pageSize)
  },
})

// ============================================
// UPDATE (Internal - worker/pipeline operations)
// ============================================

/**
 * Mark an event as processed (internal - called by workers)
 */
export const markProcessed = internalMutation({
  args: {
    id: v.id('memoryEvents'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing) {
      throw new Error('Memory event not found')
    }

    // Verify tenant ownership
    if (existing.organizationId !== args.organizationId) {
      throw new Error('Memory event does not belong to this organization')
    }

    await ctx.db.patch(args.id, {
      processed: true,
      processedAt: Date.now(),
    })

    return { success: true }
  },
})

/**
 * Mark multiple events as processed (internal - batch operation for workers).
 * Enforces MAX_BATCH_SIZE to stay within Convex mutation limits.
 */
export const markBatchProcessed = internalMutation({
  args: {
    ids: v.array(v.id('memoryEvents')),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    if (args.ids.length > MAX_BATCH_SIZE) {
      throw new Error(`Batch size ${args.ids.length} exceeds maximum of ${MAX_BATCH_SIZE}`)
    }

    const now = Date.now()
    let processedCount = 0

    for (const id of args.ids) {
      const existing = await ctx.db.get(id)
      if (existing && !existing.processed && existing.organizationId === args.organizationId) {
        await ctx.db.patch(id, {
          processed: true,
          processedAt: now,
        })
        processedCount++
      }
    }

    return { success: true, processedCount }
  },
})

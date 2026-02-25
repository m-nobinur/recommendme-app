import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { assertMemoryApiToken } from './security'

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

function hashString(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`
  const sorted = Object.keys(obj as Record<string, unknown>).sort()
  const pairs = sorted.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`
  )
  return `{${pairs.join(',')}}`
}

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
    needsArchival: v.optional(v.boolean()),
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
    authToken: v.optional(v.string()),
    eventType: eventTypeValues,
    sourceType: eventSourceTypeValues,
    sourceId: v.string(),
    idempotencyKey: v.optional(v.string()),
    data: memoryEventData,
  },
  handler: async (ctx, args) => {
    assertMemoryApiToken(args.authToken, 'memoryEvents.create')

    const derivedIdempotencyKey =
      args.idempotencyKey ??
      hashString(
        stableStringify({
          eventType: args.eventType,
          sourceType: args.sourceType,
          sourceId: args.sourceId,
          data: args.data,
        })
      )

    const existing = await ctx.db
      .query('memoryEvents')
      .withIndex('by_org_idempotency', (q) =>
        q.eq('organizationId', args.organizationId).eq('idempotencyKey', derivedIdempotencyKey)
      )
      .first()

    if (existing) {
      return existing._id
    }

    const id = await ctx.db.insert('memoryEvents', {
      organizationId: args.organizationId,
      eventType: args.eventType,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      idempotencyKey: derivedIdempotencyKey,
      data: args.data,
      processed: false,
      status: 'pending' as const,
      retryCount: 0,
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
    authToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertMemoryApiToken(args.authToken, 'memoryEvents.get')

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
    authToken: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertMemoryApiToken(args.authToken, 'memoryEvents.listUnprocessed')

    const pageSize = Math.min(args.limit ?? 10, 100)

    return await ctx.db
      .query('memoryEvents')
      .withIndex('by_org_status_created', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'pending')
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
      .withIndex('by_org_status_created', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'pending')
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
    organizationId: v.id('organizations'),
    authToken: v.optional(v.string()),
    eventType: eventTypeValues,
    processedOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertMemoryApiToken(args.authToken, 'memoryEvents.listByType')

    const pageSize = Math.min(args.limit ?? 10, 100)
    const processed = args.processedOnly ?? false

    return await ctx.db
      .query('memoryEvents')
      .withIndex('by_org_type_processed_created', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('eventType', args.eventType)
          .eq('processed', processed)
      )
      .order('desc')
      .take(pageSize)
  },
})

/**
 * List recent events for an organization (for monitoring, newest first)
 */
export const listRecent = query({
  args: {
    organizationId: v.id('organizations'),
    authToken: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertMemoryApiToken(args.authToken, 'memoryEvents.listRecent')

    const pageSize = Math.min(args.limit ?? 20, 100)

    return await ctx.db
      .query('memoryEvents')
      .withIndex('by_org_created', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')
      .take(pageSize)
  },
})

/**
 * List dead-lettered memory events for investigation.
 */
export const listDeadLetters = query({
  args: {
    organizationId: v.id('organizations'),
    authToken: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertMemoryApiToken(args.authToken, 'memoryEvents.listDeadLetters')

    const pageSize = Math.min(args.limit ?? 20, 100)
    return await ctx.db
      .query('memoryEventDeadLetters')
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
      status: 'processed' as const,
      processingStartedAt: undefined,
      lastError: undefined,
      processedAt: Date.now(),
    })

    return { success: true }
  },
})

/**
 * Mark an event as in-progress for worker processing.
 * Returns false when the event is no longer pending.
 */
export const markProcessing = internalMutation({
  args: {
    id: v.id('memoryEvents'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing || existing.organizationId !== args.organizationId) {
      return { success: false, reason: 'not_found' as const }
    }
    const effectiveStatus = existing.status ?? (existing.processed ? 'processed' : 'pending')
    if (existing.processed || effectiveStatus !== 'pending') {
      return { success: false, reason: 'not_pending' as const }
    }

    await ctx.db.patch(args.id, {
      status: 'processing' as const,
      processingStartedAt: Date.now(),
    })
    return { success: true as const }
  },
})

/**
 * Mark an event as failed and either requeue or dead-letter it.
 */
export const markFailed = internalMutation({
  args: {
    id: v.id('memoryEvents'),
    organizationId: v.id('organizations'),
    error: v.string(),
    maxRetries: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing || existing.organizationId !== args.organizationId) {
      return { success: false, deadLettered: false }
    }

    const nextRetryCount = (existing.retryCount ?? 0) + 1
    const now = Date.now()
    const shouldDeadLetter = nextRetryCount >= args.maxRetries

    if (shouldDeadLetter) {
      await ctx.db.patch(args.id, {
        processed: true,
        status: 'failed' as const,
        retryCount: nextRetryCount,
        lastError: args.error.slice(0, 500),
        failedAt: now,
        processedAt: now,
        processingStartedAt: undefined,
      })

      await ctx.db.insert('memoryEventDeadLetters', {
        organizationId: existing.organizationId,
        eventId: existing._id,
        eventType: existing.eventType,
        sourceType: existing.sourceType,
        sourceId: existing.sourceId,
        data: existing.data,
        retryCount: nextRetryCount,
        error: args.error.slice(0, 2000),
        failedAt: now,
        createdAt: now,
      })
    } else {
      await ctx.db.patch(args.id, {
        processed: false,
        status: 'pending' as const,
        retryCount: nextRetryCount,
        lastError: args.error.slice(0, 500),
        processingStartedAt: undefined,
      })
    }

    return { success: true, deadLettered: shouldDeadLetter }
  },
})

/**
 * Recover events stuck in `processing` status (e.g. worker crash).
 * Resets them to `pending` so the next extraction batch picks them up.
 */
export const recoverStuckProcessingEvents = internalMutation({
  args: {
    staleThresholdMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const threshold = args.staleThresholdMs ?? 10 * 60 * 1000
    const cutoff = Date.now() - threshold

    const stuckEvents = await ctx.db
      .query('memoryEvents')
      .withIndex('by_status_created', (q) => q.eq('status', 'processing').lt('createdAt', cutoff))
      .take(50)

    let recovered = 0
    for (const event of stuckEvents) {
      await ctx.db.patch(event._id, {
        status: 'pending' as const,
        processingStartedAt: undefined,
        lastError: 'Recovered from stuck processing state',
      })
      recovered++
    }

    if (recovered > 0) {
      console.warn('[Memory:Events] Recovered stuck processing events:', { recovered, cutoff })
    }

    return { recovered }
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
          status: 'processed' as const,
          processingStartedAt: undefined,
          lastError: undefined,
          processedAt: now,
        })
        processedCount++
      }
    }

    return { success: true, processedCount }
  },
})

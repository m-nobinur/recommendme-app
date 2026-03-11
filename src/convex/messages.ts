import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

/**
 * Save a message to the database
 */
export const save = mutation({
  args: {
    organizationId: v.id('organizations'),
    userId: v.id('appUsers'),
    conversationId: v.string(),
    messageId: v.optional(v.string()),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
    content: v.string(),
    toolCalls: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          args: v.string(),
          result: v.optional(v.string()),
        })
      )
    ),
    metadata: v.optional(
      v.object({
        model: v.optional(v.string()),
        provider: v.optional(v.string()),
        tokenCount: v.optional(v.number()),
        latencyMs: v.optional(v.number()),
        finishReason: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('messages', {
      organizationId: args.organizationId,
      userId: args.userId,
      conversationId: args.conversationId,
      messageId: args.messageId,
      role: args.role,
      content: args.content,
      toolCalls: args.toolCalls,
      metadata: args.metadata,
      createdAt: Date.now(),
    })

    return id
  },
})

/**
 * Get messages for a conversation (tenant-scoped) with cursor-based pagination.
 *
 * Messages are returned in ascending order (oldest first).
 * When `cursor` is provided, only messages created *before* that timestamp are returned
 * (for "load older" pagination). The response includes `nextCursor` when more messages exist.
 */
export const getByConversation = query({
  args: {
    conversationId: v.string(),
    organizationId: v.id('organizations'),
    limit: v.optional(v.number()),
    cursor: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 50, 100)

    const baseQuery = ctx.db
      .query('messages')
      .withIndex('by_org_conversation', (q) =>
        q.eq('organizationId', args.organizationId).eq('conversationId', args.conversationId)
      )
      .order('desc')

    const q =
      typeof args.cursor === 'number'
        ? baseQuery.filter((query) => query.lt(query.field('createdAt'), args.cursor as number))
        : baseQuery

    const batch = await q.take(pageSize + 1)
    const hasMore = batch.length > pageSize
    const page = hasMore ? batch.slice(0, pageSize) : batch

    page.reverse()

    return {
      messages: page,
      nextCursor: hasMore ? page[0].createdAt : null,
    }
  },
})

/**
 * Fetch minimal metadata for a specific messageId within an organization conversation.
 * Used by feedback ingestion to validate ownership and message role.
 */
export const getByMessageId = query({
  args: {
    conversationId: v.string(),
    organizationId: v.id('organizations'),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('messages')
      .withIndex('by_org_conversation_message', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('conversationId', args.conversationId)
          .eq('messageId', args.messageId)
      )
      .first()

    if (!row) return null

    return {
      userId: row.userId,
      role: row.role,
      messageId: row.messageId,
      conversationId: row.conversationId,
    }
  },
})

/**
 * Get recent messages for a user
 */
export const getRecentByUser = query({
  args: {
    userId: v.id('appUsers'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .order('desc')
      .take(args.limit || 50)

    return messages.reverse()
  },
})

/**
 * Get all conversations for a user (tenant-scoped)
 */
export const getConversations = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxResults = Math.min(args.limit ?? 20, 100)

    const scanLimit = maxResults * 20
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')
      .take(scanLimit)

    const conversationMap = new Map<
      string,
      { conversationId: string; lastMessage: string; createdAt: number }
    >()

    for (const msg of messages) {
      if (msg.userId !== args.userId) continue
      if (conversationMap.has(msg.conversationId)) continue

      conversationMap.set(msg.conversationId, {
        conversationId: msg.conversationId,
        lastMessage: msg.content.slice(0, 100) + (msg.content.length > 100 ? '...' : ''),
        createdAt: msg.createdAt,
      })

      if (conversationMap.size >= maxResults) break
    }

    return Array.from(conversationMap.values())
  },
})

/**
 * Delete a conversation (tenant-scoped, owner-only)
 */
export const deleteConversation = mutation({
  args: {
    conversationId: v.string(),
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_org_conversation', (q) =>
        q.eq('organizationId', args.organizationId).eq('conversationId', args.conversationId)
      )
      .take(500)

    const ownedMessages = messages.filter((m) => m.userId === args.userId)

    for (const msg of ownedMessages) {
      await ctx.db.delete(msg._id)
    }

    return { success: true, deletedCount: ownedMessages.length }
  },
})

/**
 * Clear all messages for a user (tenant-scoped)
 */
export const clearUserMessages = mutation({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .take(1000)

    let deletedCount = 0
    for (const msg of messages) {
      if (msg.userId === args.userId) {
        await ctx.db.delete(msg._id)
        deletedCount++
      }
    }

    return { success: true as const, deletedCount }
  },
})

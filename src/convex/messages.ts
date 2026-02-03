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
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
    content: v.string(),
    toolCalls: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          args: v.any(),
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
      })
    ),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert('messages', {
      organizationId: args.organizationId,
      userId: args.userId,
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      toolCalls: args.toolCalls,
      metadata: args.metadata,
      createdAt: Date.now(),
    })

    return messageId
  },
})

/**
 * Get messages for a conversation
 */
export const getByConversation = query({
  args: {
    conversationId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_conversation', (q) => q.eq('conversationId', args.conversationId))
      .order('asc')
      .collect()

    if (args.limit) {
      return messages.slice(-args.limit)
    }

    return messages
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
 * Get all conversations for a user
 */
export const getConversations = query({
  args: {
    userId: v.id('appUsers'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .order('desc')
      .collect()

    // Group by conversation and get latest message
    const conversationMap = new Map<
      string,
      { conversationId: string; lastMessage: string; createdAt: number }
    >()

    for (const msg of messages) {
      if (!conversationMap.has(msg.conversationId)) {
        conversationMap.set(msg.conversationId, {
          conversationId: msg.conversationId,
          lastMessage: msg.content.slice(0, 100) + (msg.content.length > 100 ? '...' : ''),
          createdAt: msg.createdAt,
        })
      }
    }

    const conversations = Array.from(conversationMap.values()).slice(0, args.limit || 20)

    return conversations
  },
})

/**
 * Delete a conversation
 */
export const deleteConversation = mutation({
  args: {
    conversationId: v.string(),
    userId: v.id('appUsers'),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_conversation', (q) => q.eq('conversationId', args.conversationId))
      .collect()

    // Only delete if user owns the messages
    const ownedMessages = messages.filter((m) => m.userId === args.userId)

    for (const msg of ownedMessages) {
      await ctx.db.delete(msg._id)
    }

    return { success: true, deletedCount: ownedMessages.length }
  },
})

/**
 * Clear all messages for a user
 */
export const clearUserMessages = mutation({
  args: { userId: v.id('appUsers') },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .collect()

    for (const msg of messages) {
      await ctx.db.delete(msg._id)
    }

    return { success: true, deletedCount: messages.length }
  },
})

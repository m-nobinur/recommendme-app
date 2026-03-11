import { v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { mutation } from './_generated/server'
import { assertAuthenticatedUserInOrganization } from './lib/auth'
import { redactPiiContent } from './memoryValidation'
import { assertMemoryApiToken } from './security'

type FeedbackRating = 'up' | 'down'

interface InsertFeedbackArgs {
  organizationId: Id<'organizations'>
  messageId: string
  conversationId: string
  rating: FeedbackRating
  comment?: string
  createdAt: number
}

function normalizeFeedbackArgs(args: InsertFeedbackArgs) {
  const messageId = args.messageId.trim().slice(0, 100)
  const conversationId = args.conversationId.trim().slice(0, 100)
  // Redact PII (email, phone, SSN, etc.) from user-supplied free-text comment.
  const rawComment = args.comment?.trim().slice(0, 500)
  const comment = rawComment ? redactPiiContent(rawComment) : undefined
  const numericRating = args.rating === 'up' ? 5 : 1

  if (!messageId) {
    throw new Error('messageId is required')
  }
  if (!conversationId) {
    throw new Error('conversationId is required')
  }

  return {
    messageId,
    conversationId,
    comment,
    numericRating,
    idempotencyKey: `feedback:${conversationId}:${messageId}`,
  }
}

async function validateFeedbackTarget(
  ctx: {
    db: {
      query: (...args: any[]) => {
        withIndex: (...indexArgs: any[]) => {
          first: () => Promise<{
            userId: Id<'appUsers'>
            role: 'user' | 'assistant' | 'system'
          } | null>
        }
      }
    }
  },
  args: {
    organizationId: Id<'organizations'>
    conversationId: string
    messageId: string
    expectedUserId?: Id<'appUsers'>
  }
) {
  const message = await ctx.db
    .query('messages')
    .withIndex('by_org_conversation_message', (q: any) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('conversationId', args.conversationId)
        .eq('messageId', args.messageId)
    )
    .first()

  if (!message) {
    throw new Error('Message not found for this conversation')
  }
  if (message.role !== 'assistant') {
    throw new Error('Feedback is only allowed on assistant messages')
  }
  if (args.expectedUserId && message.userId !== args.expectedUserId) {
    throw new Error('Cannot submit feedback for another user message')
  }
}

async function insertFeedbackEvent(
  ctx: {
    db: {
      query: (...args: any[]) => {
        withIndex: (...indexArgs: any[]) => {
          first: () => Promise<{ _id: Id<'memoryEvents'> } | null>
        }
      }
      insert: (...args: any[]) => Promise<Id<'memoryEvents'>>
    }
  },
  args: InsertFeedbackArgs
) {
  const normalized = normalizeFeedbackArgs(args)

  const existing = await ctx.db
    .query('memoryEvents')
    .withIndex('by_org_idempotency', (q: any) =>
      q.eq('organizationId', args.organizationId).eq('idempotencyKey', normalized.idempotencyKey)
    )
    .first()

  if (existing) {
    return existing._id
  }

  return await ctx.db.insert('memoryEvents', {
    organizationId: args.organizationId,
    eventType: 'feedback',
    sourceType: 'message',
    sourceId: normalized.messageId,
    idempotencyKey: normalized.idempotencyKey,
    data: {
      type: 'feedback' as const,
      rating: normalized.numericRating,
      comment: normalized.comment,
      messageId: normalized.messageId,
    },
    processed: false,
    status: 'pending',
    retryCount: 0,
    createdAt: args.createdAt,
  })
}

export const recordFeedback = mutation({
  args: {
    organizationId: v.id('organizations'),
    messageId: v.string(),
    conversationId: v.string(),
    rating: v.union(v.literal('up'), v.literal('down')),
    comment: v.optional(v.string()),
    authToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await assertAuthenticatedUserInOrganization(ctx as any, args.organizationId)
    if (!user) {
      throw new Error('Authenticated user is required to submit feedback')
    }

    const normalizedConversationId = args.conversationId.trim().slice(0, 100)
    const normalizedMessageId = args.messageId.trim().slice(0, 100)

    await validateFeedbackTarget(ctx as any, {
      organizationId: args.organizationId,
      conversationId: normalizedConversationId,
      messageId: normalizedMessageId,
      expectedUserId: user._id,
    })

    const eventId = await insertFeedbackEvent(ctx as any, {
      organizationId: args.organizationId,
      messageId: normalizedMessageId,
      conversationId: normalizedConversationId,
      rating: args.rating,
      comment: args.comment,
      createdAt: Date.now(),
    })

    return { eventId, success: true }
  },
})

export const recordFeedbackFromApi = mutation({
  args: {
    organizationId: v.id('organizations'),
    messageId: v.string(),
    conversationId: v.string(),
    rating: v.union(v.literal('up'), v.literal('down')),
    comment: v.optional(v.string()),
    authToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertMemoryApiToken(args.authToken, 'feedback.recordFeedbackFromApi')

    const normalizedConversationId = args.conversationId.trim().slice(0, 100)
    const normalizedMessageId = args.messageId.trim().slice(0, 100)

    await validateFeedbackTarget(ctx as any, {
      organizationId: args.organizationId,
      conversationId: normalizedConversationId,
      messageId: normalizedMessageId,
    })

    const eventId = await insertFeedbackEvent(ctx as any, {
      organizationId: args.organizationId,
      messageId: normalizedMessageId,
      conversationId: normalizedConversationId,
      rating: args.rating,
      comment: args.comment,
      createdAt: Date.now(),
    })

    return { eventId, success: true }
  },
})

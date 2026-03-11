import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { ConvexHttpClient } from 'convex/browser'
import { fetchAuthQuery } from '@/lib/auth'
import { getServerSession } from '@/lib/auth/server'
import { HTTP_STATUS } from '@/lib/constants'
import { checkSecurityRateLimitDistributed } from '@/lib/security/rateLimiting'

export const runtime = 'nodejs'

const FEEDBACK_RATE_LIMIT_SCOPE = 'feedback_submit'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

let convexClient: ConvexHttpClient | null = null
function getConvexClient(): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) return null
  if (!convexClient) {
    convexClient = new ConvexHttpClient(url)
  }
  return convexClient
}

function getClientIp(req: Request): string | undefined {
  const raw =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')
  if (!raw) return undefined
  return raw.split(',')[0]?.trim() || undefined
}

interface FeedbackRequestBody {
  messageId?: unknown
  conversationId?: unknown
  rating?: unknown
  comment?: unknown
}

interface FeedbackRouteDependencies {
  isDevMode: boolean
  getServerSession: typeof getServerSession
  fetchAuthQuery: (queryRef: unknown, args: Record<string, unknown>) => Promise<unknown>
  getConvexClient: () => ConvexHttpClient | null
  checkSecurityRateLimitDistributed: typeof checkSecurityRateLimitDistributed
  memoryAuthToken?: string
}

interface AppUserLookupResult {
  _id: string
  organizationId: string
}

interface MessageLookupResult {
  userId: string
  role: string
  conversationId: string
}

function isAppUserLookupResult(value: unknown): value is AppUserLookupResult {
  return (
    !!value &&
    typeof value === 'object' &&
    '_id' in value &&
    typeof value._id === 'string' &&
    'organizationId' in value &&
    typeof value.organizationId === 'string'
  )
}

function isMessageLookupResult(value: unknown): value is MessageLookupResult {
  return (
    !!value &&
    typeof value === 'object' &&
    'userId' in value &&
    typeof value.userId === 'string' &&
    'role' in value &&
    typeof value.role === 'string' &&
    'conversationId' in value &&
    typeof value.conversationId === 'string'
  )
}

function createDefaultDependencies(): FeedbackRouteDependencies {
  return {
    isDevMode: process.env.DISABLE_AUTH_IN_DEV === 'true' && process.env.NODE_ENV !== 'production',
    getServerSession,
    fetchAuthQuery: fetchAuthQuery as unknown as FeedbackRouteDependencies['fetchAuthQuery'],
    getConvexClient,
    checkSecurityRateLimitDistributed,
    memoryAuthToken: process.env.MEMORY_API_TOKEN,
  }
}

export function createFeedbackPostHandler(overrides: Partial<FeedbackRouteDependencies> = {}) {
  const deps: FeedbackRouteDependencies = {
    ...createDefaultDependencies(),
    ...overrides,
  }

  return async function POST(req: Request) {
    try {
      const isDevMode = deps.isDevMode

      let body: FeedbackRequestBody
      try {
        body = await req.json()
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: JSON_HEADERS,
        })
      }

      const { messageId, conversationId, rating, comment } = body

      if (typeof messageId !== 'string' || messageId.trim().length === 0) {
        return new Response(
          JSON.stringify({ error: 'messageId is required and must be a non-empty string' }),
          { status: HTTP_STATUS.BAD_REQUEST, headers: JSON_HEADERS }
        )
      }

      if (typeof conversationId !== 'string' || conversationId.trim().length === 0) {
        return new Response(
          JSON.stringify({ error: 'conversationId is required and must be a non-empty string' }),
          { status: HTTP_STATUS.BAD_REQUEST, headers: JSON_HEADERS }
        )
      }

      if (rating !== 'up' && rating !== 'down') {
        return new Response(JSON.stringify({ error: "rating must be 'up' or 'down'" }), {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: JSON_HEADERS,
        })
      }

      const normalizedMessageId = messageId.trim().slice(0, 100)
      const normalizedConversationId = conversationId.trim().slice(0, 100)

      const sanitizedComment =
        typeof comment === 'string' && comment.trim().length > 0
          ? comment.trim().slice(0, 500)
          : undefined

      let userId: string | undefined
      let organizationId: string | undefined

      if (isDevMode) {
        userId = process.env.DEV_USER_ID
        organizationId = process.env.DEV_ORGANIZATION_ID
      } else {
        const session = await deps.getServerSession()
        if (!session?.user?.id) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: HTTP_STATUS.UNAUTHORIZED,
            headers: JSON_HEADERS,
          })
        }
        const appUser = await deps.fetchAuthQuery(api.appUsers.getAppUserByAuthId, {
          authUserId: session.user.id,
        })
        if (isAppUserLookupResult(appUser)) {
          userId = appUser._id
          organizationId = appUser.organizationId
        }
      }

      if (!userId || !organizationId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: HTTP_STATUS.UNAUTHORIZED,
          headers: JSON_HEADERS,
        })
      }

      const convex = deps.getConvexClient()
      if (!convex) {
        return new Response(JSON.stringify({ error: 'Server configuration error' }), {
          status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
          headers: JSON_HEADERS,
        })
      }

      const memoryAuthToken = deps.memoryAuthToken

      const rateLimit = await deps.checkSecurityRateLimitDistributed(
        FEEDBACK_RATE_LIMIT_SCOPE,
        { userId, organizationId, ipAddress: getClientIp(req) },
        { convexClient: convex, authToken: memoryAuthToken }
      )

      if (!rateLimit.allowed) {
        return new Response(
          JSON.stringify({
            error: 'Too many feedback submissions. Please try again later.',
            retryAfter: rateLimit.retryAfterSeconds,
          }),
          {
            status: HTTP_STATUS.TOO_MANY_REQUESTS,
            headers: {
              ...JSON_HEADERS,
              'Retry-After': String(rateLimit.retryAfterSeconds),
            },
          }
        )
      }

      const message = isDevMode
        ? await convex.query(api.messages.getByMessageId, {
            organizationId: organizationId as Id<'organizations'>,
            conversationId: normalizedConversationId,
            messageId: normalizedMessageId,
          })
        : await deps.fetchAuthQuery(api.messages.getByMessageId, {
            organizationId: organizationId as Id<'organizations'>,
            conversationId: normalizedConversationId,
            messageId: normalizedMessageId,
          })

      if (!isMessageLookupResult(message)) {
        return new Response(JSON.stringify({ error: 'Message not found for this conversation' }), {
          status: HTTP_STATUS.NOT_FOUND,
          headers: JSON_HEADERS,
        })
      }

      if (message.conversationId !== normalizedConversationId) {
        return new Response(JSON.stringify({ error: 'Message conversation mismatch' }), {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: JSON_HEADERS,
        })
      }

      if (message.userId !== userId) {
        return new Response(
          JSON.stringify({ error: 'Cannot submit feedback for another user message' }),
          {
            status: HTTP_STATUS.FORBIDDEN,
            headers: JSON_HEADERS,
          }
        )
      }

      if (message.role !== 'assistant') {
        return new Response(
          JSON.stringify({ error: 'Feedback is only allowed on assistant messages' }),
          {
            status: HTTP_STATUS.BAD_REQUEST,
            headers: JSON_HEADERS,
          }
        )
      }

      const result = await convex.mutation(api.feedback.recordFeedbackFromApi, {
        organizationId: organizationId as Id<'organizations'>,
        authToken: memoryAuthToken,
        messageId: normalizedMessageId,
        conversationId: normalizedConversationId,
        rating,
        comment: sanitizedComment,
      })

      return new Response(JSON.stringify({ success: true, eventId: result.eventId }), {
        status: HTTP_STATUS.OK,
        headers: JSON_HEADERS,
      })
    } catch (error) {
      console.error('[FeedbackAPI] Unexpected error:', {
        error: error instanceof Error ? error.message : 'Unknown',
      })
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        headers: JSON_HEADERS,
      })
    }
  }
}

export const POST = createFeedbackPostHandler()

import { api } from '@convex/_generated/api'
import type { Doc, Id } from '@convex/_generated/dataModel'
import { ConvexHttpClient } from 'convex/browser'
import { getFeatureFlags } from '@/lib/ai/config'
import { fetchAuthQuery } from '@/lib/auth'
import { getServerSession } from '@/lib/auth/server'
import { HTTP_STATUS, LIMITS } from '@/lib/constants'

interface TextPart {
  type: 'text'
  text: string
}

interface ToolInvocationPart {
  type: 'tool-invocation'
  toolInvocation: {
    toolCallId: string
    toolName: string
    args: Record<string, unknown>
    state: 'result' | 'call'
    result?: unknown
  }
}

type HistoryMessagePart = TextPart | ToolInvocationPart

interface HistoryMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  parts: HistoryMessagePart[]
  createdAt: Date
}

/** Paginated history response */
interface HistoryResponse {
  messages: HistoryMessage[]
  nextCursor: number | null
}

export const runtime = 'nodejs'

let convexClient: ConvexHttpClient | null = null
function getConvexClient(): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) return null
  if (!convexClient) {
    convexClient = new ConvexHttpClient(url)
  }
  return convexClient
}

/** UUID v4 pattern for conversationId validation */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * GET /api/chat/history?conversationId=xxx[&cursor=timestamp&limit=50]
 *
 * Loads persisted conversation messages with cursor-based pagination and
 * formats them for the Vercel AI SDK UIMessage format.
 *
 * Query params:
 *  - conversationId (required): UUID of the conversation
 *  - cursor (optional): timestamp (ms) — fetch messages *older* than this
 *  - limit (optional): page size (default 50, max 100)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const conversationId = searchParams.get('conversationId')

  if (!conversationId || !UUID_REGEX.test(conversationId)) {
    return Response.json(
      { error: 'Missing or invalid conversationId parameter' },
      { status: HTTP_STATUS.BAD_REQUEST }
    )
  }

  const cursorParam = searchParams.get('cursor')
  const limitParam = searchParams.get('limit')
  const cursor = cursorParam ? Number(cursorParam) : undefined
  const limit = limitParam
    ? Math.min(Math.max(Number(limitParam), 1), 100)
    : LIMITS.HISTORY_PAGE_SIZE

  if (cursorParam && (Number.isNaN(cursor) || (cursor !== undefined && cursor <= 0))) {
    return Response.json({ error: 'Invalid cursor parameter' }, { status: HTTP_STATUS.BAD_REQUEST })
  }

  const featureFlags = getFeatureFlags()
  if (!featureFlags.enableMessagePersistence) {
    return Response.json({ messages: [], nextCursor: null } satisfies HistoryResponse)
  }

  const convex = getConvexClient()
  if (!convex) {
    return Response.json(
      { error: 'Server configuration error' },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    )
  }

  try {
    const isDevMode = process.env.DISABLE_AUTH_IN_DEV === 'true'
    let userId: string | undefined
    let organizationId: string | undefined

    if (isDevMode) {
      userId = process.env.DEV_USER_ID
      organizationId = process.env.DEV_ORGANIZATION_ID
    } else {
      const session = await getServerSession()
      if (!session?.user?.id) {
        return Response.json({ error: 'Unauthorized' }, { status: HTTP_STATUS.UNAUTHORIZED })
      }
      const appUser = await fetchAuthQuery(api.appUsers.getAppUserByAuthId, {
        authUserId: session.user.id,
      })
      if (appUser) {
        userId = appUser._id
        organizationId = appUser.organizationId
      }
    }

    if (!userId || !organizationId) {
      return Response.json(
        { error: 'User or organization not found' },
        { status: HTTP_STATUS.UNAUTHORIZED }
      )
    }

    // Fetch messages (tenant-scoped, paginated)
    const result = await convex.query(api.messages.getByConversation, {
      conversationId,
      organizationId: organizationId as Id<'organizations'>,
      limit,
      cursor,
    })

    // Convert Convex documents to UIMessage-compatible format for the Vercel AI SDK
    const uiMessages: HistoryMessage[] = result.messages.map((msg: Doc<'messages'>) => ({
      id: (msg.messageId && msg.messageId.length > 0 ? msg.messageId : null) ?? msg._id,
      role: msg.role,
      content: msg.content,
      parts: buildParts(msg),
      createdAt: new Date(msg.createdAt),
    }))

    const response: HistoryResponse = {
      messages: uiMessages,
      nextCursor: result.nextCursor,
    }

    return Response.json(response)
  } catch (error) {
    console.error('[Reme:Chat] Failed to load history:', {
      conversationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return Response.json(
      { error: 'Failed to load conversation history' },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    )
  }
}

/**
 * Safely parse a JSON string, returning fallback on failure.
 */
function safeJsonParse(value: string, fallback: unknown = {}): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

/**
 * Build typed UIMessage parts from a persisted Convex message document.
 * Tool args/result are deserialized from JSON strings back to objects.
 */
function buildParts(msg: Doc<'messages'>): HistoryMessagePart[] {
  const parts: HistoryMessagePart[] = []

  if (msg.content && msg.content !== '[No text content]') {
    parts.push({ type: 'text', text: msg.content })
  }

  if (msg.role === 'assistant' && msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      const parsedArgs = safeJsonParse(tc.args, {}) as Record<string, unknown>
      const parsedResult = tc.result !== undefined ? safeJsonParse(tc.result) : undefined

      parts.push({
        type: 'tool-invocation',
        toolInvocation: {
          toolCallId: tc.id,
          toolName: tc.name,
          args: parsedArgs,
          state: tc.result !== undefined ? 'result' : 'call',
          result: parsedResult,
        },
      })
    }
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', text: msg.content || '' })
  }

  return parts
}

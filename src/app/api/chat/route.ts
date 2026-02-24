import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import {
  convertToModelMessages,
  getToolName,
  isToolUIPart,
  stepCountIs,
  streamText,
  type TextUIPart,
  type UIMessage,
} from 'ai'
import { ConvexHttpClient } from 'convex/browser'
import { after } from 'next/server'
import { getChatConfig, getFeatureFlags, getPerformanceConfig } from '@/lib/ai/config'
import { getSystemPrompt } from '@/lib/ai/prompts/system'
import type { AIProvider, ModelTier } from '@/lib/ai/providers'
import { createAIProvider, isValidProvider, isValidTier } from '@/lib/ai/providers'
import { createCRMTools } from '@/lib/ai/tools'
import { generateRequestId } from '@/lib/ai/utils/request-id'
import { fetchAuthQuery } from '@/lib/auth'
import { getServerSession } from '@/lib/auth/server'
import { HTTP_STATUS, LIMITS } from '@/lib/constants'
import { retrieveMemoryContext } from '@/lib/memory/retrieval'

interface PersistedToolCall {
  id: string
  name: string
  args: string
  result?: string
}

let convexClient: ConvexHttpClient | null = null
function getConvexClient(): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) return null
  if (!convexClient) {
    convexClient = new ConvexHttpClient(url)
  }
  return convexClient
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VALID_ROLES = new Set(['user', 'assistant', 'system'])
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  const requestId = generateRequestId()

  const chatConfig = getChatConfig()
  const featureFlags = getFeatureFlags()
  const performanceConfig = getPerformanceConfig()
  const timeoutMs = performanceConfig.requestTimeout
  const isDevMode = process.env.DISABLE_AUTH_IN_DEV === 'true'

  try {
    const bodyPromise = req.json()
    const sessionPromise = isDevMode ? null : getServerSession()

    const body = await bodyPromise
    const {
      messages,
      provider,
      tier,
      conversationId,
    }: {
      messages: UIMessage[]
      provider?: string
      tier?: string
      conversationId?: string
    } = body

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Messages array is required and must not be empty', requestId }),
        { status: HTTP_STATUS.BAD_REQUEST, headers: JSON_HEADERS }
      )
    }

    if (messages.length > LIMITS.MAX_MESSAGES_PER_REQUEST) {
      return new Response(
        JSON.stringify({
          error: `Too many messages (max ${LIMITS.MAX_MESSAGES_PER_REQUEST})`,
          requestId,
        }),
        { status: HTTP_STATUS.BAD_REQUEST, headers: JSON_HEADERS }
      )
    }

    for (const msg of messages) {
      if (!msg.id || typeof msg.id !== 'string') {
        return new Response(
          JSON.stringify({ error: 'Each message must have a string id', requestId }),
          { status: HTTP_STATUS.BAD_REQUEST, headers: JSON_HEADERS }
        )
      }
      if (!VALID_ROLES.has(msg.role)) {
        return new Response(
          JSON.stringify({ error: `Invalid message role: ${msg.role}`, requestId }),
          { status: HTTP_STATUS.BAD_REQUEST, headers: JSON_HEADERS }
        )
      }
    }

    const resolvedProvider = provider ?? ''
    const resolvedTier = tier ?? ''
    const aiProvider: AIProvider = isValidProvider(resolvedProvider)
      ? resolvedProvider
      : chatConfig.provider
    const modelTier: ModelTier = isValidTier(resolvedTier) ? resolvedTier : chatConfig.tier

    let userId: string | undefined
    let organizationId: string | undefined

    if (isDevMode) {
      userId = process.env.DEV_USER_ID
      organizationId = process.env.DEV_ORGANIZATION_ID
    } else {
      const session = await sessionPromise
      if (!session?.user?.id) {
        return new Response(JSON.stringify({ error: 'Unauthorized', requestId }), {
          status: HTTP_STATUS.UNAUTHORIZED,
          headers: JSON_HEADERS,
        })
      }
      const appUser = await fetchAuthQuery(api.appUsers.getAppUserByAuthId, {
        authUserId: session.user.id,
      })
      if (appUser) {
        userId = appUser._id
        organizationId = appUser.organizationId
      }
    }

    let lastUserMessage: UIMessage | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMessage = messages[i]
        break
      }
    }
    const lastUserMessageText = lastUserMessage ? extractTextContent(lastUserMessage) : ''

    let nicheId: string | undefined
    if (featureFlags.enableMemory && organizationId) {
      const convex = getConvexClient()
      if (convex) {
        try {
          const org = await convex.query(api.organizations.getOrganization, {
            id: organizationId as Id<'organizations'>,
          })
          nicheId = org?.settings?.nicheId ?? undefined
        } catch {
          // nicheId is optional; niche layer simply gets skipped
        }
      }
    }

    const memoryPromise =
      featureFlags.enableMemory && organizationId
        ? retrieveMemoryContext({
            query: lastUserMessageText,
            organizationId,
            nicheId,
            agentType: 'chat',
            convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? '',
          })
        : Promise.resolve(null)

    const tools =
      userId && organizationId
        ? createCRMTools({
            organizationId,
            userId,
            convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? '',
          })
        : undefined

    const model = createAIProvider(aiProvider, modelTier)

    const memoryResult = await memoryPromise
    const systemPrompt = getSystemPrompt(memoryResult?.context ?? '')

    if (chatConfig.debug && memoryResult) {
      console.log('[Reme:Memory] Retrieved context:', {
        requestId,
        organizationId,
        memoriesUsed: memoryResult.memoriesUsed,
        tokenCount: memoryResult.tokenCount,
        latencyMs: memoryResult.latencyMs,
        layerBreakdown: memoryResult.layerBreakdown,
      })
    }

    const validConversationId =
      conversationId && UUID_REGEX.test(conversationId) ? conversationId : undefined

    const convex = getConvexClient()
    const canPersist =
      featureFlags.enableMessagePersistence &&
      validConversationId &&
      userId &&
      organizationId &&
      convex

    if (canPersist && lastUserMessage) {
      const userContent = lastUserMessageText.slice(0, LIMITS.MAX_MESSAGE_LENGTH)
      const msgId = lastUserMessage.id
      after(async () => {
        try {
          await convex.mutation(api.messages.save, {
            organizationId: organizationId as Id<'organizations'>,
            userId: userId as Id<'appUsers'>,
            conversationId: validConversationId,
            messageId: msgId,
            role: 'user' as const,
            content: userContent,
          })
        } catch (err) {
          console.error('[Reme:Chat] Failed to persist user message:', {
            requestId,
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      })
    }

    const requestStartTime = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const result = streamText({
        model,
        system: systemPrompt,
        messages: await convertToModelMessages(messages),
        tools,
        stopWhen: stepCountIs(chatConfig.maxSteps),
        abortSignal: controller.signal,
      })

      return result.toUIMessageStreamResponse({
        originalMessages: messages,
        onFinish: ({ responseMessage, finishReason }) => {
          clearTimeout(timeout)
          const latencyMs = Date.now() - requestStartTime

          if (canPersist) {
            const content = extractTextContent(responseMessage)
            const toolCalls = extractToolCalls(responseMessage)
            const msgId = responseMessage.id || crypto.randomUUID()

            after(async () => {
              try {
                await convex.mutation(api.messages.save, {
                  organizationId: organizationId as Id<'organizations'>,
                  userId: userId as Id<'appUsers'>,
                  conversationId: validConversationId,
                  messageId: msgId,
                  role: 'assistant' as const,
                  content: content || '[No text content]',
                  toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                  metadata: {
                    model: modelTier,
                    provider: aiProvider,
                    latencyMs,
                    finishReason: finishReason ?? undefined,
                  },
                })

                if (chatConfig.debug) {
                  console.log('[Reme:Chat] Messages persisted:', {
                    requestId,
                    conversationId: validConversationId,
                    toolCallCount: toolCalls.length,
                  })
                }
              } catch (err) {
                console.error('[Reme:Chat] Failed to persist assistant message:', {
                  requestId,
                  organizationId,
                  conversationId: validConversationId,
                  error: err instanceof Error ? err.message : 'Unknown error',
                })
              }
            })
          }

          if (featureFlags.enableMemory && organizationId && validConversationId && convex) {
            const orgId = organizationId as Id<'organizations'>

            after(async () => {
              try {
                await convex.mutation(api.memoryEvents.create, {
                  organizationId: orgId,
                  eventType: 'conversation_end' as const,
                  sourceType: 'message' as const,
                  sourceId: validConversationId,
                  data: {
                    type: 'conversation_end' as const,
                    conversationId: validConversationId,
                    messageCount: messages.length,
                    lastUserMessage: lastUserMessageText.slice(0, 500),
                    finishReason: finishReason ?? 'unknown',
                    latencyMs,
                  },
                })
              } catch (err) {
                console.error('[Reme:Chat] Failed to emit conversation_end event:', {
                  requestId,
                  organizationId,
                  conversationId: validConversationId,
                  error: err instanceof Error ? err.message : 'Unknown error',
                })
              }
            })

            const toolCallParts = extractToolCalls(responseMessage)
            if (toolCallParts.length > 0) {
              after(async () => {
                for (const tc of toolCallParts) {
                  const hasError = tc.result?.includes('"error"') || tc.result?.includes('Error')
                  try {
                    await convex.mutation(api.memoryEvents.create, {
                      organizationId: orgId,
                      eventType: hasError ? ('tool_failure' as const) : ('tool_success' as const),
                      sourceType: 'tool_call' as const,
                      sourceId: tc.id,
                      data: {
                        type: 'tool_result' as const,
                        toolName: tc.name,
                        args: tc.args?.slice(0, 500),
                        result: tc.result?.slice(0, 500),
                        durationMs: latencyMs,
                      },
                    })
                  } catch (err) {
                    console.error('[Reme:Chat] Failed to emit tool event:', {
                      requestId,
                      organizationId,
                      toolName: tc.name,
                      error: err instanceof Error ? err.message : 'Unknown error',
                    })
                  }
                }
              })
            }
          }

          if (chatConfig.debug) {
            console.log('[Reme:Chat] Chat completed:', {
              requestId,
              finishReason,
              messageId: responseMessage.id,
              provider: aiProvider,
              tier: modelTier,
              latencyMs,
            })
          }
        },
      })
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[Reme:Chat] Request timeout:', { requestId, timeout: timeoutMs })
      return new Response(
        JSON.stringify({ error: 'Request timeout', requestId, timeout: timeoutMs }),
        { status: HTTP_STATUS.GATEWAY_TIMEOUT, headers: JSON_HEADERS }
      )
    }

    console.error('[Reme:Chat] API error:', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'An error occurred',
        requestId,
      }),
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR, headers: JSON_HEADERS }
    )
  }
}

function extractTextContent(message: UIMessage): string {
  if (!message.parts || message.parts.length === 0) return ''
  return message.parts
    .filter((part): part is TextUIPart => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function extractToolCalls(message: UIMessage): PersistedToolCall[] {
  if (!message.parts || message.parts.length === 0) return []
  const toolCalls: PersistedToolCall[] = []

  for (const part of message.parts) {
    if (isToolUIPart(part)) {
      const rawResult = 'output' in part ? part.output : undefined
      toolCalls.push({
        id: part.toolCallId,
        name: getToolName(part),
        args: JSON.stringify(part.input ?? {}),
        result: rawResult !== undefined ? JSON.stringify(rawResult) : undefined,
      })
    }
  }

  return toolCalls
}

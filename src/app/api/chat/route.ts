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
import { createCRMTools, createMemoryTools } from '@/lib/ai/tools'
import { generateRequestId } from '@/lib/ai/utils/request-id'
import { fetchAuthQuery } from '@/lib/auth'
import { getServerSession } from '@/lib/auth/server'
import { HTTP_STATUS, LIMITS } from '@/lib/constants'
import { buildConversationWindow, formatSummaryForPrompt } from '@/lib/memory/conversationSummary'
import { retrieveMemoryContext } from '@/lib/memory/retrieval'

interface PersistedToolCall {
  id: string
  name: string
  args: string
  result?: string
}

type MemorySignalType =
  | 'user_correction'
  | 'explicit_instruction'
  | 'approval_granted'
  | 'approval_rejected'
  | 'feedback'

type MemoryEventData =
  | {
      type: 'user_input'
      content: string
      originalContent?: string
    }
  | {
      type: 'approval'
      actionDescription: string
      approved: boolean
      reason?: string
    }
  | {
      type: 'feedback'
      rating?: number
      comment?: string
      messageId?: string
    }

interface NormalizedMemorySignal {
  eventType: MemorySignalType
  sourceType: 'message' | 'agent_action'
  sourceId: string
  data: MemoryEventData
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
const MEMORY_RETRIEVAL_SLO_MS = Number(process.env.AI_MEMORY_RETRIEVAL_SLO_MS ?? 1800)
const CHAT_LATENCY_SLO_MS = Number(process.env.AI_CHAT_LATENCY_SLO_MS ?? 12000)

export async function POST(req: Request) {
  const requestId = generateRequestId()

  const chatConfig = getChatConfig()
  const featureFlags = getFeatureFlags()
  const performanceConfig = getPerformanceConfig()
  const memoryAuthToken = process.env.MEMORY_API_TOKEN
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
      memorySignals,
    }: {
      messages: UIMessage[]
      provider?: string
      tier?: string
      conversationId?: string
      memorySignals?: unknown
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
    const validConversationId =
      conversationId && UUID_REGEX.test(conversationId) ? conversationId : undefined

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
    const normalizedMemorySignals = normalizeMemorySignals(
      memorySignals,
      lastUserMessage,
      validConversationId
    )
    const inferredSignals = inferMemorySignalsFromMessage(lastUserMessage)
    const memorySignalsToEmit = dedupeMemorySignals([
      ...normalizedMemorySignals,
      ...inferredSignals,
    ])

    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? ''
    const convexForMemory = getConvexClient()

    const nicheLookupPromise: Promise<string | undefined> =
      featureFlags.enableMemory && organizationId && convexForMemory
        ? convexForMemory
            .query(api.organizations.getOrganization, {
              id: organizationId as Id<'organizations'>,
            })
            .then((org) => org?.settings?.nicheId ?? undefined)
            .catch(() => undefined)
        : Promise.resolve(undefined)

    const memoryPromise =
      featureFlags.enableMemory && organizationId
        ? (async () => {
            const nicheId = await Promise.race<string | undefined>([
              nicheLookupPromise,
              new Promise((resolve) => setTimeout(() => resolve(undefined), 75)),
            ])
            return retrieveMemoryContext({
              query: lastUserMessageText,
              organizationId,
              authToken: memoryAuthToken,
              nicheId,
              agentType: 'chat',
              convexUrl,
              traceId: requestId,
            })
          })()
        : Promise.resolve(null)
    const toolCtx =
      userId && organizationId
        ? {
            organizationId,
            userId,
            convexUrl,
            convexClient: convexForMemory ?? undefined,
            memoryAuthToken,
          }
        : null

    const crmTools = toolCtx ? createCRMTools(toolCtx) : undefined
    const memoryTools =
      featureFlags.enableMemory && toolCtx ? createMemoryTools(toolCtx) : undefined
    const tools = crmTools || memoryTools ? { ...crmTools, ...memoryTools } : undefined

    const model = createAIProvider(aiProvider, modelTier)

    const [memoryResult, summaryResult] = await Promise.all([
      memoryPromise,
      featureFlags.enableMemory && messages.length > 6
        ? buildConversationWindow(messages)
        : Promise.resolve(null),
    ])

    const conversationSummaryText = summaryResult
      ? formatSummaryForPrompt(summaryResult.summary)
      : ''
    const systemPrompt = getSystemPrompt(memoryResult?.context ?? '', conversationSummaryText)
    const llmMessages = summaryResult?.wasTrimmed ? summaryResult.messages : messages

    if (chatConfig.debug && memoryResult) {
      const skippedLayers = (['platform', 'niche', 'business', 'agent'] as const).filter(
        (l) => memoryResult.layerBreakdown[l] === 0
      )
      console.log('[Reme:Memory] Retrieved context:', {
        requestId,
        organizationId,
        memoriesUsed: memoryResult.memoriesUsed,
        tokenCount: memoryResult.tokenCount,
        latencyMs: memoryResult.latencyMs,
        layerBreakdown: memoryResult.layerBreakdown,
        ...(skippedLayers.length > 0 && { skippedLayers }),
      })
    }

    if (memoryResult && memoryResult.latencyMs > MEMORY_RETRIEVAL_SLO_MS) {
      console.warn('[Reme:SLO] Memory retrieval latency breach', {
        requestId,
        organizationId,
        latencyMs: memoryResult.latencyMs,
        sloMs: MEMORY_RETRIEVAL_SLO_MS,
      })
    }

    if (chatConfig.debug && summaryResult?.wasTrimmed) {
      console.log('[Reme:Summary] Conversation trimmed:', {
        requestId,
        originalMessages: summaryResult.totalOriginal,
        windowMessages: summaryResult.messages.length,
        hasSummary: summaryResult.summary.length > 0,
        needsArchival: summaryResult.needsArchival,
      })
    }

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
        messages: await convertToModelMessages(llmMessages),
        tools,
        stopWhen: stepCountIs(chatConfig.maxSteps),
        abortSignal: controller.signal,
      })

      return result.toUIMessageStreamResponse({
        originalMessages: messages,
        onFinish: ({ responseMessage, finishReason }) => {
          clearTimeout(timeout)
          const latencyMs = Date.now() - requestStartTime
          if (latencyMs > CHAT_LATENCY_SLO_MS) {
            console.warn('[Reme:SLO] Chat latency breach', {
              requestId,
              organizationId,
              latencyMs,
              sloMs: CHAT_LATENCY_SLO_MS,
            })
          }

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
                  authToken: memoryAuthToken,
                  eventType: 'conversation_end' as const,
                  sourceType: 'message' as const,
                  sourceId: validConversationId,
                  idempotencyKey: `${validConversationId}:conversation_end`,
                  data: {
                    type: 'conversation_end' as const,
                    conversationId: validConversationId,
                    messageCount: summaryResult?.totalOriginal ?? messages.length,
                    lastUserMessage: lastUserMessageText.slice(0, 500),
                    finishReason: summaryResult?.needsArchival
                      ? 'archive_threshold'
                      : (finishReason ?? 'unknown'),
                    latencyMs,
                    needsArchival: summaryResult?.needsArchival ?? false,
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
                  let hasError = false
                  if (tc.result) {
                    try {
                      const parsed = JSON.parse(tc.result)
                      hasError = parsed?.success === false || parsed?.error !== undefined
                    } catch {
                      hasError = false
                    }
                  }
                  try {
                    await convex.mutation(api.memoryEvents.create, {
                      organizationId: orgId,
                      authToken: memoryAuthToken,
                      eventType: hasError ? ('tool_failure' as const) : ('tool_success' as const),
                      sourceType: 'tool_call' as const,
                      sourceId: tc.id,
                      idempotencyKey: `${tc.id}:${hasError ? 'tool_failure' : 'tool_success'}`,
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

          if (
            featureFlags.enableMemory &&
            organizationId &&
            convex &&
            memorySignalsToEmit.length > 0
          ) {
            const orgId = organizationId as Id<'organizations'>

            after(async () => {
              for (const signal of memorySignalsToEmit) {
                const eventScopeId = validConversationId ?? signal.sourceId
                try {
                  await convex.mutation(api.memoryEvents.create, {
                    organizationId: orgId,
                    authToken: memoryAuthToken,
                    eventType: signal.eventType,
                    sourceType: signal.sourceType,
                    sourceId: signal.sourceId,
                    idempotencyKey: `${eventScopeId}:${signal.eventType}:${signal.sourceId}`,
                    data: signal.data,
                  })
                } catch (err) {
                  console.error('[Reme:Chat] Failed to emit user memory signal event:', {
                    requestId,
                    organizationId,
                    eventType: signal.eventType,
                    sourceId: signal.sourceId,
                    error: err instanceof Error ? err.message : 'Unknown error',
                  })
                }
              }
            })
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

function normalizeMemorySignals(
  rawSignals: unknown,
  lastUserMessage: UIMessage | undefined,
  conversationId: string | undefined
): NormalizedMemorySignal[] {
  if (!Array.isArray(rawSignals)) {
    return []
  }

  const defaultSourceId = lastUserMessage?.id ?? conversationId
  if (!defaultSourceId) {
    return []
  }

  const normalized: NormalizedMemorySignal[] = []

  for (const signal of rawSignals) {
    if (!signal || typeof signal !== 'object') {
      continue
    }

    const candidate = signal as {
      type?: unknown
      sourceId?: unknown
      content?: unknown
      originalContent?: unknown
      actionDescription?: unknown
      reason?: unknown
      rating?: unknown
      comment?: unknown
      messageId?: unknown
    }

    if (typeof candidate.type !== 'string') {
      continue
    }

    const sourceId =
      typeof candidate.sourceId === 'string' && candidate.sourceId.trim().length > 0
        ? candidate.sourceId.trim()
        : defaultSourceId

    if (candidate.type === 'user_correction' || candidate.type === 'explicit_instruction') {
      if (typeof candidate.content !== 'string') {
        continue
      }
      const content = candidate.content.trim().slice(0, 500)
      if (content.length < 10) {
        continue
      }
      const originalContent =
        typeof candidate.originalContent === 'string' && candidate.originalContent.trim().length > 0
          ? candidate.originalContent.trim().slice(0, 500)
          : undefined

      normalized.push({
        eventType: candidate.type,
        sourceType: 'message',
        sourceId,
        data: {
          type: 'user_input',
          content,
          originalContent,
        },
      })
      continue
    }

    if (candidate.type === 'approval_granted' || candidate.type === 'approval_rejected') {
      if (typeof candidate.actionDescription !== 'string') {
        continue
      }
      const actionDescription = candidate.actionDescription.trim().slice(0, 500)
      if (actionDescription.length < 3) {
        continue
      }

      const reason =
        typeof candidate.reason === 'string' && candidate.reason.trim().length > 0
          ? candidate.reason.trim().slice(0, 500)
          : undefined

      normalized.push({
        eventType: candidate.type,
        sourceType: 'agent_action',
        sourceId,
        data: {
          type: 'approval',
          actionDescription,
          approved: candidate.type === 'approval_granted',
          reason,
        },
      })
      continue
    }

    if (candidate.type === 'feedback') {
      const rating =
        typeof candidate.rating === 'number' && candidate.rating >= 1 && candidate.rating <= 5
          ? candidate.rating
          : undefined
      const comment =
        typeof candidate.comment === 'string' && candidate.comment.trim().length > 0
          ? candidate.comment.trim().slice(0, 500)
          : undefined
      const messageId =
        typeof candidate.messageId === 'string' && candidate.messageId.trim().length > 0
          ? candidate.messageId.trim().slice(0, 100)
          : undefined

      if (rating === undefined && !comment) {
        continue
      }

      normalized.push({
        eventType: 'feedback',
        sourceType: 'message',
        sourceId,
        data: {
          type: 'feedback',
          rating,
          comment,
          messageId,
        },
      })
    }
  }

  return normalized
}

function inferMemorySignalsFromMessage(
  lastUserMessage: UIMessage | undefined
): NormalizedMemorySignal[] {
  if (!lastUserMessage?.id) {
    return []
  }

  const text = extractTextContent(lastUserMessage).trim()
  if (!text) {
    return []
  }

  const inferred: NormalizedMemorySignal[] = []
  const correctionContent = extractPrefixedContent(text, [
    'correction:',
    'correct this:',
    "that's incorrect:",
    'you are wrong:',
  ])
  if (correctionContent && correctionContent.length >= 10) {
    inferred.push({
      eventType: 'user_correction',
      sourceType: 'message',
      sourceId: lastUserMessage.id,
      data: {
        type: 'user_input',
        content: correctionContent.slice(0, 500),
      },
    })
  }

  const instructionContent = extractPrefixedContent(text, [
    'instruction:',
    'remember:',
    'rule:',
    'from now on:',
  ])
  if (instructionContent && instructionContent.length >= 10) {
    inferred.push({
      eventType: 'explicit_instruction',
      sourceType: 'message',
      sourceId: lastUserMessage.id,
      data: {
        type: 'user_input',
        content: instructionContent.slice(0, 500),
      },
    })
  }

  const approvalGranted = extractPrefixedContent(text, [
    'approve:',
    'approved:',
    'approval granted:',
  ])
  if (approvalGranted && approvalGranted.length >= 3) {
    inferred.push({
      eventType: 'approval_granted',
      sourceType: 'agent_action',
      sourceId: lastUserMessage.id,
      data: {
        type: 'approval',
        actionDescription: approvalGranted.slice(0, 500),
        approved: true,
      },
    })
  }

  const approvalRejected = extractPrefixedContent(text, [
    'reject:',
    'rejected:',
    'approval rejected:',
  ])
  if (approvalRejected && approvalRejected.length >= 3) {
    inferred.push({
      eventType: 'approval_rejected',
      sourceType: 'agent_action',
      sourceId: lastUserMessage.id,
      data: {
        type: 'approval',
        actionDescription: approvalRejected.slice(0, 500),
        approved: false,
      },
    })
  }

  const feedbackContent = extractPrefixedContent(text, ['feedback:'])
  if (feedbackContent && feedbackContent.length > 0) {
    const rating = parseFeedbackRating(feedbackContent)
    const comment = feedbackContent.slice(0, 500)
    if (rating !== undefined || comment.length > 0) {
      inferred.push({
        eventType: 'feedback',
        sourceType: 'message',
        sourceId: lastUserMessage.id,
        data: {
          type: 'feedback',
          rating,
          comment,
        },
      })
    }
  }

  return inferred
}

function dedupeMemorySignals(signals: NormalizedMemorySignal[]): NormalizedMemorySignal[] {
  const seen = new Set<string>()
  const deduped: NormalizedMemorySignal[] = []

  for (const signal of signals) {
    const key = `${signal.eventType}:${signal.sourceId}:${JSON.stringify(signal.data)}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(signal)
  }

  return deduped
}

function extractPrefixedContent(text: string, prefixes: string[]): string | undefined {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim()
    }
  }

  return undefined
}

function parseFeedbackRating(content: string): number | undefined {
  const slashMatch = content.match(/\b([1-5])\s*\/\s*5\b/)
  if (slashMatch) {
    return Number(slashMatch[1])
  }

  const keywordMatch = content.match(/\b(?:rating|score)\s*[:=]?\s*([1-5])\b/i)
  if (keywordMatch) {
    return Number(keywordMatch[1])
  }

  return undefined
}

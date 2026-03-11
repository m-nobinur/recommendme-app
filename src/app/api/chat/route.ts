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
import {
  buildConversationWindow,
  formatSummaryForPrompt,
} from '@/lib/ai/memory/conversationSummary'
import { retrieveMemoryContext } from '@/lib/ai/memory/retrieval'
import { getSystemPrompt } from '@/lib/ai/prompts/system'
import type { AIProvider, ModelTier } from '@/lib/ai/providers'
import { createAIProvider, getModelId, isValidProvider, isValidTier } from '@/lib/ai/providers'
import {
  createApprovalTools,
  createCRMTools,
  createInvoiceTools,
  createMemoryTools,
  createReminderTools,
  createSalesFunnelTools,
} from '@/lib/ai/tools'
import { generateRequestId } from '@/lib/ai/utils/request-id'
import { fetchAuthQuery } from '@/lib/auth'
import { getServerSession } from '@/lib/auth/server'
import { HTTP_STATUS, LIMITS } from '@/lib/constants'
import { getTierLimits } from '@/lib/cost/budgets'
import {
  downgradeModelTier,
  evaluateBudgetRouting,
  getConversationWindowSize,
  resolveBudgetTier,
  trimMemoryContextForBudget,
} from '@/lib/cost/manager'
import { estimateCost } from '@/lib/cost/pricing'
import { sanitizeForLogging, validateMessagesInput } from '@/lib/security/inputValidation'
import { checkSecurityRateLimitDistributed } from '@/lib/security/rateLimiting'
import { classifyTenantIsolationError } from '@/lib/security/tenantIsolation'
import { TraceContext } from '@/lib/tracing'
import { type LangfuseGenerationUsage, syncTraceToLangfuse } from '@/lib/tracing/langfuse'
import { withSpan } from '@/lib/tracing/spans'

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

interface OrganizationRuntimeSettings {
  nicheId?: string
  timezone?: string
  budgetTier?: string
}

interface BudgetStatusSnapshot {
  daily: {
    tokensUsed: number
    tokenLimit: number
    percentUsed: number
    costUsd: number
  }
  monthly: {
    tokensUsed: number
    tokenLimit: number
    percentUsed: number
    costUsd: number
  }
  truncated: boolean
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
const BUDGET_CACHE_TTL_MS = 10_000
const MAX_BUDGET_CACHE_ENTRIES = 1_000
const budgetStatusCache = new Map<string, { snapshot: BudgetStatusSnapshot; expiresAt: number }>()

function getCachedBudgetStatus(cacheKey: string): BudgetStatusSnapshot | null {
  const cached = budgetStatusCache.get(cacheKey)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    budgetStatusCache.delete(cacheKey)
    return null
  }
  return cached.snapshot
}

function setCachedBudgetStatus(cacheKey: string, snapshot: BudgetStatusSnapshot): void {
  const now = Date.now()
  if (budgetStatusCache.size >= MAX_BUDGET_CACHE_ENTRIES) {
    for (const [key, entry] of budgetStatusCache) {
      if (entry.expiresAt <= now) {
        budgetStatusCache.delete(key)
      }
    }

    while (budgetStatusCache.size >= MAX_BUDGET_CACHE_ENTRIES) {
      const oldestKey = budgetStatusCache.keys().next().value
      if (!oldestKey) break
      budgetStatusCache.delete(oldestKey)
    }
  }

  budgetStatusCache.set(cacheKey, {
    snapshot,
    expiresAt: now + BUDGET_CACHE_TTL_MS,
  })
}

function getClientIp(req: Request): string | undefined {
  const raw =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')
  if (!raw) return undefined
  const first = raw.split(',')[0]?.trim()
  return first || undefined
}

async function recordSecurityEvent(input: {
  organizationId?: string
  userId?: string
  action: string
  details: Record<string, unknown>
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  traceId?: string
  ipAddress?: string
}): Promise<void> {
  if (!input.organizationId) return

  const convex = getConvexClient()
  if (!convex) return

  try {
    await convex.mutation(api.auditLogs.recordSecurityEvent, {
      authToken: process.env.MEMORY_API_TOKEN,
      organizationId: input.organizationId as Id<'organizations'>,
      userId: input.userId ? (input.userId as Id<'appUsers'>) : undefined,
      action: input.action,
      details: input.details,
      riskLevel: input.riskLevel,
      traceId: input.traceId,
      ipAddress: input.ipAddress,
    })
  } catch (error) {
    console.error('[Reme:Security] Failed to record security event:', {
      action: input.action,
      organizationId: input.organizationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

export const runtime = 'nodejs'
export const maxDuration = 60
const MEMORY_RETRIEVAL_SLO_MS = Number(process.env.AI_MEMORY_RETRIEVAL_SLO_MS ?? 1800)
const CHAT_LATENCY_SLO_MS = Number(process.env.AI_CHAT_LATENCY_SLO_MS ?? 12000)

export async function POST(req: Request) {
  const requestId = generateRequestId()
  const trace = new TraceContext({ traceId: requestId })
  const rootSpanId = trace.startSpan('chat.request', 'api')

  const chatConfig = getChatConfig()
  const featureFlags = getFeatureFlags()
  const performanceConfig = getPerformanceConfig()
  const memoryAuthToken = process.env.MEMORY_API_TOKEN
  const timeoutMs = performanceConfig.requestTimeout
  const isDevMode = process.env.DISABLE_AUTH_IN_DEV === 'true'
  let traceOrganizationId: string | undefined
  let traceUserId: string | undefined

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

    const userMessagesForValidation = messages
      .filter((msg) => msg.role === 'user')
      .map((msg) => ({
        role: msg.role,
        content: msg.parts
          ? msg.parts
              .filter((p): p is TextUIPart => p.type === 'text')
              .map((p) => p.text)
              .join('')
          : '',
      }))
    const validation = validateMessagesInput(userMessagesForValidation)
    if (!validation.safe) {
      const sampleUnsafeContent = userMessagesForValidation.find(
        (msg) => msg.content.trim().length > 0
      )
      console.warn('[Reme:Security] Input validation failed:', {
        requestId,
        threats: validation.threats,
        content: sanitizeForLogging(sampleUnsafeContent?.content ?? '', 200),
      })
      return new Response(
        JSON.stringify({
          error: 'Your message was flagged by our safety system. Please rephrase your request.',
          requestId,
          threats: validation.threats,
        }),
        { status: HTTP_STATUS.BAD_REQUEST, headers: JSON_HEADERS }
      )
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
      traceOrganizationId = organizationId
      traceUserId = userId
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
        traceOrganizationId = organizationId
        traceUserId = userId
      }
    }

    const requestIp = getClientIp(req)
    const chatRateLimit = await checkSecurityRateLimitDistributed(
      'chat_request',
      {
        userId,
        organizationId,
        ipAddress: requestIp,
      },
      {
        convexClient: getConvexClient(),
        authToken: memoryAuthToken,
      }
    )
    if (!chatRateLimit.allowed) {
      void recordSecurityEvent({
        organizationId,
        userId,
        action: 'chat.rate_limited',
        riskLevel: 'medium',
        traceId: requestId,
        ipAddress: requestIp,
        details: {
          scope: chatRateLimit.scope,
          key: chatRateLimit.key,
          limit: chatRateLimit.limit,
          resetAt: chatRateLimit.resetAt,
        },
      })
      return new Response(
        JSON.stringify({
          error: 'Too many chat requests. Please retry shortly.',
          requestId,
          rateLimit: {
            scope: chatRateLimit.scope,
            limit: chatRateLimit.limit,
            remaining: chatRateLimit.remaining,
            resetAt: chatRateLimit.resetAt,
          },
        }),
        {
          status: HTTP_STATUS.TOO_MANY_REQUESTS,
          headers: {
            ...JSON_HEADERS,
            'Retry-After': String(chatRateLimit.retryAfterSeconds),
          },
        }
      )
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

    const orgLookupPromise: Promise<OrganizationRuntimeSettings> = organizationId
      ? isDevMode
        ? convexForMemory
          ? convexForMemory
              .query(api.organizations.getOrganization, {
                id: organizationId as Id<'organizations'>,
              })
              .then((org) => ({
                nicheId: org?.settings?.nicheId ?? undefined,
                timezone: org?.settings?.timezone ?? undefined,
                budgetTier: org?.settings?.budgetTier ?? undefined,
              }))
              .catch(() => ({}))
          : Promise.resolve({})
        : fetchAuthQuery(api.organizations.getOrganization, {
            id: organizationId as Id<'organizations'>,
          })
            .then((org) => ({
              nicheId: org?.settings?.nicheId ?? undefined,
              timezone: org?.settings?.timezone ?? undefined,
              budgetTier: org?.settings?.budgetTier ?? undefined,
            }))
            .catch(() => ({}))
      : Promise.resolve({})

    const orgSettingsPromise = Promise.race([
      orgLookupPromise,
      new Promise<OrganizationRuntimeSettings>((resolve) => setTimeout(() => resolve({}), 75)),
    ])

    const orgSettings = await orgSettingsPromise
    let effectiveModelTier: ModelTier = modelTier
    let reduceContextForBudget = false
    let budgetStatusForTrace: 'ok' | 'warning' | 'exceeded' = 'ok'
    let budgetReason = 'Budget check skipped'

    if (organizationId && (isDevMode ? convexForMemory : true)) {
      try {
        const budgetTier = resolveBudgetTier(orgSettings.budgetTier)
        const limits = getTierLimits(budgetTier)
        const convexForBudget = convexForMemory ?? getConvexClient()
        const budgetArgs = {
          organizationId: organizationId as Id<'organizations'>,
          dailyLimitTokens: limits.dailyTokens,
          monthlyLimitTokens: limits.monthlyTokens,
          nowMs: Date.now(),
          maxRows: 10000,
        }
        const cacheKey = `${organizationId}:${limits.dailyTokens}:${limits.monthlyTokens}`
        const cachedSnapshot = getCachedBudgetStatus(cacheKey)
        const budgetSnapshot: BudgetStatusSnapshot =
          cachedSnapshot ??
          (await withSpan<BudgetStatusSnapshot>(
            trace,
            'budget.check',
            'internal',
            async () =>
              isDevMode
                ? convexForBudget
                  ? convexForBudget.query(api.llmUsage.getOrgBudgetStatus, budgetArgs)
                  : Promise.reject(new Error('Convex client unavailable for dev budget check'))
                : fetchAuthQuery(api.llmUsage.getOrgBudgetStatus, budgetArgs),
            { organizationId, budgetTier },
            rootSpanId
          ))

        if (!cachedSnapshot && !budgetSnapshot.truncated) {
          setCachedBudgetStatus(cacheKey, budgetSnapshot)
        }

        let budgetDecision = evaluateBudgetRouting({
          requestedTier: modelTier,
          budgetTier: orgSettings.budgetTier,
          usage: {
            dailyTokensUsed: budgetSnapshot.daily.tokensUsed,
            monthlyTokensUsed: budgetSnapshot.monthly.tokensUsed,
          },
        })

        if (budgetSnapshot.truncated) {
          budgetDecision = {
            ...budgetDecision,
            budget: {
              ...budgetDecision.budget,
              status: 'exceeded',
            },
            effectiveTier: 'regular',
            reduceContext: true,
            allowLlmCall: false,
            retryAfterSeconds: 15 * 60,
            reason:
              'Usage scan truncated during budget evaluation; blocking request to prevent limit overrun.',
          }
        }

        effectiveModelTier = budgetDecision.effectiveTier
        reduceContextForBudget = budgetDecision.reduceContext
        budgetStatusForTrace = budgetDecision.budget.status
        budgetReason = budgetDecision.reason

        if (!budgetDecision.allowLlmCall) {
          trace.endSpan(rootSpanId, 'ok', {
            budgetStatus: budgetDecision.budget.status,
            budgetReason: budgetDecision.reason,
            provider: aiProvider,
            requestedTier: modelTier,
            effectiveTier: budgetDecision.effectiveTier,
          })

          const orgId = organizationId as Id<'organizations'>
          after(async () => {
            try {
              const spans = trace.getCompletedSpans()
              if (spans.length > 0 && convexForBudget) {
                await convexForBudget.mutation(api.traces.recordSpans, {
                  authToken: memoryAuthToken,
                  spans: spans.map((s) => ({
                    ...s,
                    organizationId: orgId,
                  })),
                })
              }

              await syncTraceToLangfuse({
                traceId: requestId,
                organizationId,
                userId: traceUserId,
                spans,
                metadata: {
                  provider: aiProvider,
                  requestedTier: modelTier,
                  effectiveTier: budgetDecision.effectiveTier,
                  budgetStatus: budgetDecision.budget.status,
                  budgetReason: budgetDecision.reason,
                },
              })
            } catch (err) {
              console.error('[Reme:Trace] Failed to persist budget-exceeded trace spans:', {
                requestId,
                error: err instanceof Error ? err.message : 'Unknown error',
              })
            }
          })

          return new Response(
            JSON.stringify({
              error:
                'AI usage budget limit reached for your workspace. Please retry later or upgrade your plan.',
              requestId,
              budget: {
                tier: budgetDecision.budgetTier,
                status: budgetDecision.budget.status,
                dailyPercent: budgetDecision.budget.dailyPercent,
                monthlyPercent: budgetDecision.budget.monthlyPercent,
              },
            }),
            {
              status: HTTP_STATUS.TOO_MANY_REQUESTS,
              headers: {
                ...JSON_HEADERS,
                'Retry-After': String(budgetDecision.retryAfterSeconds ?? 3600),
              },
            }
          )
        }
      } catch (error) {
        effectiveModelTier = downgradeModelTier(modelTier)
        reduceContextForBudget = true
        budgetStatusForTrace = 'warning'
        budgetReason = 'Budget check unavailable; applied conservative degraded mode.'
        console.warn('[Reme:Budget] Budget check failed, falling back to conservative mode', {
          requestId,
          organizationId,
          requestedTier: modelTier,
          effectiveTier: effectiveModelTier,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    const toolCtx =
      userId && organizationId
        ? {
            organizationId,
            userId,
            convexUrl,
            convexClient: convexForMemory ?? undefined,
            memoryAuthToken,
            timezone: orgSettings.timezone,
          }
        : null

    const crmTools = toolCtx ? createCRMTools(toolCtx) : undefined
    const reminderTools = toolCtx ? createReminderTools(toolCtx) : undefined
    const invoiceTools = toolCtx ? createInvoiceTools(toolCtx) : undefined
    const salesFunnelTools = toolCtx ? createSalesFunnelTools(toolCtx) : undefined
    const approvalTools = toolCtx ? createApprovalTools(toolCtx) : undefined
    const memoryTools =
      featureFlags.enableMemory && toolCtx ? createMemoryTools(toolCtx) : undefined
    const tools =
      crmTools || reminderTools || invoiceTools || salesFunnelTools || approvalTools || memoryTools
        ? {
            ...crmTools,
            ...reminderTools,
            ...invoiceTools,
            ...salesFunnelTools,
            ...approvalTools,
            ...memoryTools,
          }
        : undefined

    const memoryPromise =
      featureFlags.enableMemory && organizationId
        ? withSpan(
            trace,
            'memory.retrieve',
            'retrieval',
            async () =>
              retrieveMemoryContext({
                query: lastUserMessageText,
                organizationId,
                authToken: memoryAuthToken,
                nicheId: orgSettings.nicheId,
                agentType: 'chat',
                convexUrl,
                traceId: requestId,
              }),
            { organizationId },
            rootSpanId
          )
        : Promise.resolve(null)

    const model = createAIProvider(aiProvider, effectiveModelTier)
    const resolvedModelId = getModelId(aiProvider, effectiveModelTier)
    const summaryWindowSize = getConversationWindowSize({ reduceContext: reduceContextForBudget })

    const [memoryResult, summaryResult] = await Promise.all([
      memoryPromise,
      featureFlags.enableMemory && messages.length > 6
        ? buildConversationWindow(messages, {
            windowSize: summaryWindowSize,
            summaryMaxTokens: reduceContextForBudget ? 120 : undefined,
            provider: aiProvider,
            modelTier: effectiveModelTier,
          })
        : Promise.resolve(null),
    ])

    const conversationSummaryText = summaryResult
      ? formatSummaryForPrompt(summaryResult.summary)
      : ''
    const memoryContext = trimMemoryContextForBudget(memoryResult?.context ?? '', {
      reduceContext: reduceContextForBudget,
    })
    const systemPrompt = getSystemPrompt(memoryContext, conversationSummaryText)
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
    let langfuseGeneration: LangfuseGenerationUsage | undefined

    try {
      const llmStartTime = Date.now()
      const result = streamText({
        model,
        system: systemPrompt,
        messages: await convertToModelMessages(llmMessages),
        tools,
        stopWhen: stepCountIs(chatConfig.maxSteps),
        abortSignal: controller.signal,
        onFinish({ usage, totalUsage }) {
          const sdkUsage = totalUsage ?? usage
          if (!sdkUsage || !organizationId || !convex) return
          const llmLatencyMs = Date.now() - llmStartTime
          const orgId = organizationId as Id<'organizations'>
          const inputTokens = sdkUsage.inputTokens ?? 0
          const outputTokens = sdkUsage.outputTokens ?? 0
          const totalTokens = sdkUsage.totalTokens ?? inputTokens + outputTokens
          if (totalTokens === 0) return
          const estimatedCostUsd = estimateCost(resolvedModelId, inputTokens, outputTokens)
          langfuseGeneration = {
            id: `${requestId}:chat`,
            name: 'chat.completion',
            model: resolvedModelId,
            inputTokens,
            outputTokens,
            totalTokens,
            estimatedCostUsd,
            startTimeMs: llmStartTime,
            endTimeMs: Date.now(),
          }

          after(async () => {
            try {
              await convex.mutation(api.llmUsage.recordUsage, {
                authToken: memoryAuthToken,
                organizationId: orgId,
                traceId: requestId,
                model: resolvedModelId,
                provider: aiProvider,
                inputTokens,
                outputTokens,
                totalTokens,
                estimatedCostUsd,
                purpose: 'chat' as const,
                cached: (sdkUsage.cachedInputTokens ?? 0) > 0,
                latencyMs: llmLatencyMs,
              })
            } catch (err) {
              console.error('[Reme:Usage] Failed to record chat LLM usage:', {
                requestId,
                error: err instanceof Error ? err.message : 'Unknown error',
              })
            }
          })
        },
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
                    model: effectiveModelTier,
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
                  idempotencyKey: `${validConversationId}:conversation_end:${lastUserMessage?.id ?? Date.now()}`,
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

          trace.endSpan(rootSpanId, 'ok', {
            finishReason,
            provider: aiProvider,
            requestedTier: modelTier,
            effectiveTier: effectiveModelTier,
            budgetStatus: budgetStatusForTrace,
            budgetReason,
            latencyMs,
          })

          if (organizationId && convex) {
            const orgId = organizationId as Id<'organizations'>
            after(async () => {
              try {
                const spans = trace.getCompletedSpans()
                if (spans.length > 0) {
                  await convex.mutation(api.traces.recordSpans, {
                    authToken: memoryAuthToken,
                    spans: spans.map((s) => ({
                      ...s,
                      organizationId: orgId,
                    })),
                  })
                }

                await syncTraceToLangfuse({
                  traceId: requestId,
                  organizationId,
                  userId: traceUserId,
                  spans,
                  generation: langfuseGeneration,
                  metadata: {
                    provider: aiProvider,
                    requestedTier: modelTier,
                    effectiveTier: effectiveModelTier,
                    budgetStatus: budgetStatusForTrace,
                    budgetReason,
                  },
                })
              } catch (err) {
                console.error('[Reme:Trace] Failed to persist trace spans:', {
                  requestId,
                  error: err instanceof Error ? err.message : 'Unknown error',
                })
              }
            })
          }

          if (chatConfig.debug) {
            console.log('[Reme:Chat] Chat completed:', {
              requestId,
              finishReason,
              messageId: responseMessage.id,
              provider: aiProvider,
              requestedTier: modelTier,
              effectiveTier: effectiveModelTier,
              budgetStatus: budgetStatusForTrace,
              latencyMs,
            })
          }
        },
      })
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    trace.endAllActive('error')
    const convex = getConvexClient()
    if (traceOrganizationId && convex) {
      const orgId = traceOrganizationId as Id<'organizations'>
      after(async () => {
        try {
          const spans = trace.getCompletedSpans()
          if (spans.length > 0) {
            await convex.mutation(api.traces.recordSpans, {
              authToken: memoryAuthToken,
              spans: spans.map((s) => ({
                ...s,
                organizationId: orgId,
              })),
            })
          }

          await syncTraceToLangfuse({
            traceId: requestId,
            organizationId: traceOrganizationId,
            userId: traceUserId,
            spans,
            metadata: {
              status: 'error',
            },
          })
        } catch (err) {
          console.error('[Reme:Trace] Failed to persist trace spans on error:', {
            requestId,
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      })
    }

    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[Reme:Chat] Request timeout:', { requestId, timeout: timeoutMs })
      return new Response(
        JSON.stringify({ error: 'Request timeout', requestId, timeout: timeoutMs }),
        { status: HTTP_STATUS.GATEWAY_TIMEOUT, headers: JSON_HEADERS }
      )
    }

    const tenantErrorCode = classifyTenantIsolationError(error)
    if (tenantErrorCode) {
      void recordSecurityEvent({
        organizationId: traceOrganizationId,
        userId: traceUserId,
        action: 'chat.tenant_isolation_violation',
        riskLevel: 'high',
        traceId: requestId,
        details: {
          code: tenantErrorCode,
          message: error instanceof Error ? error.message : String(error),
        },
      })
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
    const key = `${signal.eventType}:${signal.sourceId}:${JSON.stringify(signal.data, Object.keys(signal.data).sort())}`
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

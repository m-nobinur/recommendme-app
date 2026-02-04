import { api } from '@convex/_generated/api'
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { getChatConfig, getFeatureFlags, getPerformanceConfig } from '@/lib/ai/config'
import { getSystemPrompt } from '@/lib/ai/prompts/system'
import type { AIProvider, ModelTier } from '@/lib/ai/providers'
import { createAIProvider, isValidProvider, isValidTier } from '@/lib/ai/providers'
import { createCRMTools } from '@/lib/ai/tools'
import { generateRequestId } from '@/lib/ai/utils/request-id'
import { fetchAuthQuery } from '@/lib/auth'
import { getServerSession } from '@/lib/auth/server'
import { HTTP_STATUS } from '@/lib/constants'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  const requestId = generateRequestId()

  const chatConfig = getChatConfig()
  const featureFlags = getFeatureFlags()
  const performanceConfig = getPerformanceConfig()
  const timeoutMs = performanceConfig.requestTimeout

  try {
    // Verify authentication (skip in dev if DISABLE_AUTH_IN_DEV is set)
    const isDevMode = process.env.DISABLE_AUTH_IN_DEV === 'true'

    const body = await req.json()
    const {
      messages,
      provider,
      tier,
    }: { messages: UIMessage[]; provider?: string; tier?: string } = body

    // Provider override should be restricted (security consideration)
    // FIXME: In production, consider checking user permissions before allowing overrides
    const aiProvider: AIProvider = isValidProvider(provider || '')
      ? (provider as AIProvider)
      : chatConfig.provider
    const modelTier: ModelTier = isValidTier(tier || '') ? (tier as ModelTier) : chatConfig.tier

    let userId: string | undefined
    let organizationId: string | undefined

    if (isDevMode) {
      userId = process.env.DEV_USER_ID
      organizationId = process.env.DEV_ORGANIZATION_ID
    } else {
      const session = await getServerSession()
      if (!session?.user?.id) {
        return new Response(JSON.stringify({ error: 'Unauthorized', requestId }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
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

    const tools =
      userId && organizationId
        ? createCRMTools({
            organizationId,
            userId,
            convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? '',
          })
        : undefined

    const model = createAIProvider(aiProvider, modelTier)

    const memoryContext = featureFlags.enableMemory
      ? '' // TODO: Fetch memory context from mem0 when implemented
      : ''
    const systemPrompt = getSystemPrompt(memoryContext)

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
        onFinish: async ({ responseMessage, finishReason }) => {
          clearTimeout(timeout)

          if (featureFlags.enableMessagePersistence) {
            // TODO: Implement message persistence to Convex
            console.log('[Reme:Chat] Message persistence enabled but not implemented', {
              requestId,
            })
          }

          // Track analytics if enabled
          if (featureFlags.enableAnalytics) {
            // TODO: Track usage metrics (tokens, latency, etc.)
            console.log('[Reme:Chat] Analytics tracking enabled but not implemented', {
              requestId,
            })
          }

          // Log completion
          if (chatConfig.debug) {
            console.log('[Reme:Chat] Chat completed:', {
              requestId,
              finishReason,
              messageId: responseMessage.id,
              provider: aiProvider,
              tier: modelTier,
            })
          }
        },
      })
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[Reme:Chat] Request timeout:', {
        requestId,
        timeout: timeoutMs,
      })
      return new Response(
        JSON.stringify({
          error: 'Request timeout',
          requestId,
          timeout: timeoutMs,
        }),
        {
          status: HTTP_STATUS.GATEWAY_TIMEOUT,
          headers: { 'Content-Type': 'application/json' },
        }
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
      {
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

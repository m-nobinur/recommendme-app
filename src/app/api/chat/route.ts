import { api } from '@convex/_generated/api'
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { getSystemPrompt } from '@/lib/ai/prompts/system'
import type { AIProvider, ModelTier } from '@/lib/ai/providers'
import { createAIProvider, isValidProvider, isValidTier } from '@/lib/ai/providers'
import { createCRMTools } from '@/lib/ai/tools'
import { fetchAuthQuery, isAuthenticated } from '@/lib/auth'
import { getServerSession } from '@/lib/auth/server'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  try {
    // Verify authentication (skip in dev if DISABLE_AUTH_IN_DEV is set)
    const isDevMode = process.env.DISABLE_AUTH_IN_DEV === 'true'

    if (!isDevMode) {
      const authenticated = await isAuthenticated()
      if (!authenticated) {
        return new Response('Unauthorized', { status: 401 })
      }
    }

    const body = await req.json()
    const {
      messages,
      provider,
      tier,
    }: { messages: UIMessage[]; provider?: string; tier?: string } = body

    // Validate provider and tier - use Gemini as default
    const aiProvider: AIProvider = isValidProvider(provider || '')
      ? (provider as AIProvider)
      : 'gemini'
    const modelTier: ModelTier = isValidTier(tier || '') ? (tier as ModelTier) : 'smart'

    // Get user context from session
    let userId: string | undefined
    let organizationId: string | undefined

    if (isDevMode) {
      // In dev mode, use DEV_ORGANIZATION_ID and DEV_USER_ID from .env.local
      userId = process.env.DEV_USER_ID
      organizationId = process.env.DEV_ORGANIZATION_ID
    } else {
      // In production, get from authenticated session
      const session = await getServerSession()
      if (session?.user?.id) {
        // Fetch appUser by auth user ID to get organizationId
        const appUser = await fetchAuthQuery(api.appUsers.getAppUserByAuthId, {
          authUserId: session.user.id,
        })
        if (appUser) {
          userId = appUser._id
          organizationId = appUser.organizationId
        }
      }
    }

    // Create tools with user context (only if we have valid IDs)
    const tools =
      userId && organizationId
        ? createCRMTools({
            organizationId,
            userId,
            convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? '',
          })
        : undefined

    // Create AI model instance
    const model = createAIProvider(aiProvider, modelTier)

    // Get system prompt with memory context
    // TODO: Fetch memory context from mem0
    const memoryContext = ''
    const systemPrompt = getSystemPrompt(memoryContext)

    // Stream the response
    const result = streamText({
      model,
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(5), // Allow up to 5 steps for multi-step tool calling
    })

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      onFinish: async ({ responseMessage, finishReason }) => {
        // TODO: Save message to Convex for persistence
        console.log('Chat completed:', {
          finishReason,
          messageId: responseMessage.id,
        })
      },
    })
  } catch (error) {
    console.error('Chat API error:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'An error occurred',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

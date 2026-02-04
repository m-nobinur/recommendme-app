import { generateText, NoObjectGeneratedError, Output } from 'ai'
import { z } from 'zod'
import { getSuggestionsConfig } from '@/lib/ai/config'
import {
  DEFAULT_SUGGESTION_CONFIG,
  getSuggestionPrompt,
  type SuggestionConfig,
} from '@/lib/ai/prompts/suggestions'
import type { AIProvider, ModelTier } from '@/lib/ai/providers'
import { createAIProvider } from '@/lib/ai/providers'
import { recordError, recordSuccess } from '@/lib/ai/utils/monitoring'
import { generateRequestId } from '@/lib/ai/utils/request-id'
import { isRetryableError, withRetry } from '@/lib/ai/utils/retry'

const suggestionOutputSchema = z.object({
  suggestions: z
    .array(z.string().min(3).max(100).describe('A short, actionable follow-up question'))
    .describe('Array of follow-up questions the user might want to ask'),
})

/**
 * Options for suggestion generation
 */
export interface GenerateSuggestionsOptions {
  provider?: AIProvider
  tier?: ModelTier
  temperature?: number
  config?: Partial<SuggestionConfig>
  debug?: boolean
}

/**
 * Result type for suggestion generation
 */
export interface SuggestionResult {
  /** Generated suggestions */
  suggestions: string[]
  /** Token usage information */
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  /** Response metadata */
  metadata?: {
    provider: AIProvider
    tier: ModelTier
    temperature: number
    finishReason?: string
  }
}

/**
 * Error result for failed generation
 */
export interface SuggestionError {
  error: string
  cause?: unknown
}

/**
 * Generate follow-up suggestions based on conversation context
 *
 * Uses structured output with Zod validation for robust, type-safe results.
 * Optimized for speed with fast models (regular tier) for parallel generation.
 *
 * @param userMessage - The user's original message
 * @param aiResponse - The AI's response to use as context
 * @param options - Optional configuration for generation
 * @returns Promise resolving to suggestions or error
 *
 * @example
 * ```ts
 * const result = await generateSuggestions(
 *   "How do I add a new lead?",
 *   "To add a new lead, navigate to the Leads section...",
 *   { provider: 'gemini', tier: 'regular' }
 * )
 *
 * if ('suggestions' in result) {
 *   console.log(result.suggestions)
 *   // ["How do I update lead status?", "Can I import leads?", ...]
 * } else {
 *   console.error(result.error)
 * }
 * ```
 */
export async function generateSuggestions(
  userMessage: string,
  aiResponse: string,
  options: GenerateSuggestionsOptions = {}
): Promise<SuggestionResult | SuggestionError> {
  const requestId = generateRequestId()
  const startTime = Date.now()

  const globalConfig = getSuggestionsConfig()

  const config: SuggestionConfig = {
    ...DEFAULT_SUGGESTION_CONFIG,
    ...{
      minSuggestions: globalConfig.minSuggestions,
      maxSuggestions: globalConfig.maxSuggestions,
      maxWordsPerSuggestion: globalConfig.maxWordsPerSuggestion,
      responseContextLimit: globalConfig.responseContextLimit,
    },
    ...options.config,
  }

  const provider: AIProvider = options.provider ?? globalConfig.provider
  const tier: ModelTier = options.tier ?? globalConfig.tier
  const temperature = options.temperature ?? globalConfig.temperature
  const debug = options.debug ?? globalConfig.debug

  try {
    const model = createAIProvider(provider, tier)

    const prompt = getSuggestionPrompt(userMessage, aiResponse, config)

    if (debug) {
      console.log('[Reme:Suggestions] Generating with config:', {
        requestId,
        provider,
        tier,
        temperature,
        config,
      })
    }

    const result = await withRetry(
      async () =>
        generateText({
          model,
          output: Output.object({
            schema: suggestionOutputSchema,
          }),
          prompt,
          temperature,
        }),
      {
        maxAttempts: 2,
        shouldRetry: isRetryableError,
        onRetry: (error, attempt, delay) => {
          console.warn(`[Reme:Suggestions] Retry attempt ${attempt} after ${delay}ms`, {
            requestId,
            error: error instanceof Error ? error.message : String(error),
          })
        },
      }
    )

    const { suggestions } = result.output

    const trimmedSuggestions = suggestions
      .slice(0, config.maxSuggestions)
      .filter((s) => s.length > 0)

    if (trimmedSuggestions.length < config.minSuggestions) {
      console.warn(
        `[Reme:Suggestions] Generated ${trimmedSuggestions.length} suggestions, expected at least ${config.minSuggestions}`
      )
      if (trimmedSuggestions.length === 0) {
        return {
          error: 'Failed to generate minimum required suggestions',
          cause: 'Model returned no valid suggestions',
        }
      }
    }

    const duration = Date.now() - startTime
    const usage = result.usage
      ? {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
        }
      : undefined

    recordSuccess('suggestions', requestId, duration, usage, {
      provider,
      tier,
      temperature,
      count: trimmedSuggestions.length,
    })

    if (debug) {
      console.log('[Reme:Suggestions] Generated successfully:', {
        requestId,
        duration: `${duration}ms`,
        count: trimmedSuggestions.length,
        tokens: usage?.totalTokens,
      })
    }

    return {
      suggestions: trimmedSuggestions,
      usage,
      metadata: {
        provider,
        tier,
        temperature,
        finishReason: result.finishReason,
      },
    }
  } catch (error) {
    const duration = Date.now() - startTime

    if (NoObjectGeneratedError.isInstance(error)) {
      const errorMessage = 'Failed to generate valid suggestion structure'
      const errorDetails = {
        error: errorMessage,
        cause: {
          requestId,
          message: 'Model output did not match expected schema',
          text: error.text,
          finishReason: error.finishReason,
          usage: error.usage,
        },
      }

      recordError('suggestions', requestId, duration, errorMessage, {
        provider,
        tier,
        cause: 'NoObjectGeneratedError',
      })

      console.error('[Reme:Suggestions] NoObjectGeneratedError:', errorDetails)
      return errorDetails
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

    recordError('suggestions', requestId, duration, errorMessage, {
      provider,
      tier,
    })

    console.error('[Reme:Suggestions] Generation failed:', {
      requestId,
      error: errorMessage,
      provider,
      tier,
      duration: `${duration}ms`,
    })

    return {
      error: `Suggestion generation failed: ${errorMessage} (Request ID: ${requestId})`,
      cause: error,
    }
  }
}

/**
 * Type guard to check if result is successful
 */
export function isSuggestionResult(
  result: SuggestionResult | SuggestionError
): result is SuggestionResult {
  return (
    'suggestions' in result &&
    Array.isArray(result.suggestions) &&
    result.suggestions.every((s) => typeof s === 'string')
  )
}

/**
 * Type guard to check if result is an error
 */
export function isSuggestionError(
  result: SuggestionResult | SuggestionError
): result is SuggestionError {
  return 'error' in result && typeof result.error === 'string'
}

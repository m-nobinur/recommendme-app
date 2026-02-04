'use server'

import {
  generateSuggestions as generateSuggestionsService,
  isSuggestionResult,
} from '@/lib/ai/services'

/**
 * Generates follow-up suggestions based on the user's message
 *
 * Configuration is loaded from environment variables via @/lib/ai/config
 * See .env.ai.example for available configuration options
 *
 * @param userMessage - The user's original message
 * @param aiResponse - The AI's response to use as context
 * @returns Array of follow-up question suggestions, empty array on error
 */
export async function generateSuggestions(
  userMessage: string,
  aiResponse: string
): Promise<string[]> {
  if (!userMessage || !aiResponse) {
    console.warn('[Reme:Suggestions] Missing required parameters')
    return []
  }

  const result = await generateSuggestionsService(userMessage, aiResponse)

  if (isSuggestionResult(result)) {
    return result.suggestions
  }

  console.error('[Reme:Suggestions] Server action failed:', result.error)
  return []
}

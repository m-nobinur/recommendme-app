/**
 * Prompt Version Management
 * Centralized prompt version retrieval.
 */

/**
 * Get active system prompt version
 * @returns System prompt version string (defaults to 'v1')
 */
export function getActiveSystemPromptVersion(): string {
  const envVersion = process.env.AI_SYSTEM_PROMPT_VERSION
  if (envVersion) return envVersion

  return 'v1'
}

/**
 * Get active suggestion prompt version
 * @returns Suggestion prompt version string (defaults to 'v2')
 */
export function getActiveSuggestionPromptVersion(): string {
  const envVersion = process.env.AI_SUGGESTION_PROMPT_VERSION
  if (envVersion) return envVersion

  return 'v2'
}

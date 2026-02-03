/**
 * Environment variable validation and management for AI providers
 */

/**
 * Validates and retrieves an API key from environment variables
 *
 * @param envVar - Name of the environment variable
 * @param providerName - Human-readable provider name for error messages
 * @returns The API key
 * @throws Error if API key is missing or invalid
 *
 * @example
 * ```ts
 * const apiKey = validateApiKey('OPENAI_API_KEY', 'OpenAI')
 * ```
 */
export function validateApiKey(envVar: string, providerName: string): string {
  const apiKey = process.env[envVar]

  if (!apiKey) {
    throw new Error(
      `Missing API key for ${providerName}. Please set ${envVar} in your environment variables.`
    )
  }

  if (apiKey.trim().length === 0) {
    throw new Error(`Invalid API key for ${providerName}. ${envVar} is empty.`)
  }

  // Basic validation for common API key formats
  if (apiKey.includes(' ')) {
    throw new Error(
      `Invalid API key for ${providerName}. ${envVar} contains whitespace. Please check your environment variables.`
    )
  }

  return apiKey
}

/**
 * Checks if an API key is configured without throwing
 *
 * @param envVar - Name of the environment variable
 * @returns true if the API key is configured and valid
 *
 * @example
 * ```ts
 * if (hasApiKey('OPENAI_API_KEY')) {
 *   // OpenAI is available
 * }
 * ```
 */
export function hasApiKey(envVar: string): boolean {
  const apiKey = process.env[envVar]
  return Boolean(apiKey && apiKey.trim().length > 0 && !apiKey.includes(' '))
}

/**
 * Gets an API key if available, returns undefined if not
 *
 * @param envVar - Name of the environment variable
 * @returns The API key or undefined
 *
 * @example
 * ```ts
 * const apiKey = getApiKey('OPENAI_API_KEY')
 * if (apiKey) {
 *   // Use OpenAI
 * }
 * ```
 */
export function getApiKey(envVar: string): string | undefined {
  try {
    return validateApiKey(envVar, envVar)
  } catch {
    return undefined
  }
}

/**
 * Environment variable names for all providers
 */
export const ENV_VARS = {
  AI_GATEWAY: 'AI_GATEWAY_API_KEY',
  GOOGLE_GEMINI: 'GOOGLE_GENERATIVE_AI_API_KEY',
  OPENAI: 'OPENAI_API_KEY',
  OPENROUTER: 'OPENROUTER_API_KEY',
  GROQ: 'GROQ_API_KEY',
} as const

/**
 * Checks which providers are configured
 *
 * @returns Object with boolean flags for each provider
 *
 * @example
 * ```ts
 * const configured = getConfiguredProviders()
 * if (configured.openai) {
 *   // OpenAI is available
 * }
 * ```
 */
export function getConfiguredProviders() {
  return {
    gateway: hasApiKey(ENV_VARS.AI_GATEWAY) || true, // Can work without API key on Vercel
    gemini: hasApiKey(ENV_VARS.GOOGLE_GEMINI),
    openai: hasApiKey(ENV_VARS.OPENAI),
    openrouter: hasApiKey(ENV_VARS.OPENROUTER),
    groq: hasApiKey(ENV_VARS.GROQ),
  }
}

/**
 * Gets a list of available provider names
 *
 * @returns Array of provider IDs that have valid API keys
 *
 * @example
 * ```ts
 * const available = getAvailableProviderNames()
 * console.log('Available providers:', available)
 * // ['gemini', 'openai']
 * ```
 */
export function getAvailableProviderNames(): string[] {
  const configured = getConfiguredProviders()
  return Object.entries(configured)
    .filter(([, isConfigured]) => isConfigured)
    .map(([provider]) => provider)
}

/**
 * Validates that at least one provider is configured
 *
 * @throws Error if no providers are configured
 */
export function ensureAtLeastOneProvider(): void {
  const available = getAvailableProviderNames()

  if (available.length === 0) {
    throw new Error(
      'No AI providers configured. Please set at least one API key:\n' +
        `  - ${ENV_VARS.GOOGLE_GEMINI} for Google Gemini\n` +
        `  - ${ENV_VARS.OPENAI} for OpenAI\n` +
        `  - ${ENV_VARS.OPENROUTER} for OpenRouter\n` +
        `  - ${ENV_VARS.GROQ} for Groq\n` +
        `  - ${ENV_VARS.AI_GATEWAY} for AI Gateway (optional on Vercel)`
    )
  }
}

/**
 * Gets diagnostic information about provider configuration
 *
 * @returns Object with configuration status
 */
export function getDiagnostics() {
  const configured = getConfiguredProviders()
  const available = getAvailableProviderNames()

  return {
    configured,
    available,
    count: available.length,
    hasAny: available.length > 0,
    recommendations: getRecommendations(configured),
  }
}

/**
 * Gets recommendations based on current configuration
 */
function getRecommendations(configured: ReturnType<typeof getConfiguredProviders>) {
  const recommendations: string[] = []

  if (!configured.gemini) {
    recommendations.push('Consider setting up Google Gemini for high-quality, cost-effective AI')
  }

  if (!configured.gateway) {
    recommendations.push('AI Gateway provides automatic failover and caching (optional on Vercel)')
  }

  if (!configured.openai && !configured.openrouter) {
    recommendations.push('OpenAI or OpenRouter can provide access to GPT models')
  }

  if (!configured.groq) {
    recommendations.push('Groq offers ultra-fast inference with LPU technology')
  }

  return recommendations
}

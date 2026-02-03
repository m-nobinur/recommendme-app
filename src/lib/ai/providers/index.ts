import type { LanguageModel } from 'ai'
import {
  AI_GATEWAY_CONFIG,
  GEMINI_CONFIG,
  GROQ_CONFIG,
  OPENAI_CONFIG,
  OPENROUTER_CONFIG,
  PROVIDER_CONFIGS,
} from '@/lib/ai/providers/config'
import {
  createGatewayProvider,
  createGeminiProvider,
  createGroqProvider,
  createOpenAIProvider,
  createOpenRouterProvider,
} from '@/lib/ai/providers/factories'
import type { ProviderConfig } from '@/lib/ai/providers/types'

export {
  DEFAULT_PROVIDER,
  DEFAULT_TIER,
  isValidProvider,
  isValidTier,
  PROVIDER_CONFIGS,
  TIER_INFO,
} from '@/lib/ai/providers/config'
/**
 * Re-export types for external use
 */
export type { AIProvider, ModelConfig, ModelTier, ProviderConfig } from '@/lib/ai/providers/types'

/**
 * Provider factory registry
 * Maps provider names to their factory functions
 */
const PROVIDER_FACTORIES = {
  gateway: createGatewayProvider,
  gemini: createGeminiProvider,
  openai: createOpenAIProvider,
  openrouter: createOpenRouterProvider,
  groq: createGroqProvider,
} as const

/**
 * Creates an AI provider instance with the specified provider and model tier
 *
 * @param provider - The AI provider to use (gateway, gemini, openai, openrouter, groq)
 * @param tier - The model tier (smartest, smart, regular)
 * @returns Configured LanguageModel instance
 * @throws Error if provider is invalid or API key is missing
 *
 * @example
 * ```ts
 * const model = createAIProvider('gemini', 'smart')
 * const result = await generateText({ model, prompt: 'Hello!' })
 * ```
 */
export function createAIProvider(
  provider: keyof typeof PROVIDER_FACTORIES = 'gemini',
  tier: keyof ProviderConfig['models'] = 'smart'
): LanguageModel {
  // Validate provider
  if (!(provider in PROVIDER_FACTORIES)) {
    throw new Error(
      `Invalid provider: ${provider}. Valid providers: ${Object.keys(PROVIDER_FACTORIES).join(', ')}`
    )
  }

  // Get provider config
  const providerConfig = PROVIDER_CONFIGS[provider]
  if (!providerConfig) {
    throw new Error(`Configuration not found for provider: ${provider}`)
  }

  // Validate tier
  if (!(tier in providerConfig.models)) {
    throw new Error(
      `Invalid tier: ${String(tier)}. Valid tiers: ${Object.keys(providerConfig.models).join(', ')}`
    )
  }

  // Get model ID for the tier
  const modelId = providerConfig.models[tier].id

  // Create provider instance using factory
  const factory = PROVIDER_FACTORIES[provider]
  return factory(modelId)
}

/**
 * Get the model ID for a specific provider and tier
 *
 * @param provider - The AI provider
 * @param tier - The model tier
 * @returns The model ID string
 *
 * @example
 * ```ts
 * const modelId = getModelId('gemini', 'smart')
 * // Returns: 'gemini-2.5-flash'
 * ```
 */
export function getModelId(
  provider: keyof typeof PROVIDER_FACTORIES,
  tier: keyof ProviderConfig['models']
): string {
  const config = PROVIDER_CONFIGS[provider]
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`)
  }

  const model = config.models[tier]
  if (!model) {
    throw new Error(`Unknown tier: ${String(tier)} for provider: ${String(provider)}`)
  }

  return model.id
}

/**
 * Direct provider instance creators
 * Useful when you need a specific provider without going through the factory
 */
export const providers = {
  /**
   * Creates an AI Gateway provider instance
   * Requires AI_GATEWAY_API_KEY env variable
   */
  gateway: (modelId = PROVIDER_CONFIGS.gateway.models.smart.id) => createGatewayProvider(modelId),

  /**
   * Creates a Gemini provider instance
   * Requires GOOGLE_GENERATIVE_AI_API_KEY env variable
   */
  gemini: (modelId = PROVIDER_CONFIGS.gemini.models.smart.id) => createGeminiProvider(modelId),

  /**
   * Creates an OpenAI provider instance
   * Requires OPENAI_API_KEY env variable
   */
  openai: (modelId = PROVIDER_CONFIGS.openai.models.smart.id) => createOpenAIProvider(modelId),

  /**
   * Creates an OpenRouter provider instance
   * Requires OPENROUTER_API_KEY env variable
   */
  openrouter: (modelId = PROVIDER_CONFIGS.openrouter.models.smart.id) =>
    createOpenRouterProvider(modelId),

  /**
   * Creates a Groq provider instance
   * Requires GROQ_API_KEY env variable
   */
  groq: (modelId = PROVIDER_CONFIGS.groq.models.smart.id) => createGroqProvider(modelId),
} as const

/**
 * Provider configuration exports
 * Useful for UI and debugging
 */
export const providerConfigs = {
  gateway: AI_GATEWAY_CONFIG,
  gemini: GEMINI_CONFIG,
  openai: OPENAI_CONFIG,
  openrouter: OPENROUTER_CONFIG,
  groq: GROQ_CONFIG,
} as const

/**
 * Checks if an API key is configured for a provider
 *
 * @param provider - The provider to check
 * @returns true if the API key is configured
 */
export function hasApiKey(provider: keyof typeof PROVIDER_FACTORIES): boolean {
  const config = PROVIDER_CONFIGS[provider]
  if (!config?.apiKeyEnvVar) return true // No API key required

  const apiKey = process.env[config.apiKeyEnvVar]
  return Boolean(apiKey && apiKey.length > 0)
}

/**
 * Gets a list of all available providers with their configurations
 *
 * @returns Array of provider configurations
 */
export function getAvailableProviders(): ProviderConfig[] {
  return Object.values(PROVIDER_CONFIGS)
}

/**
 * Gets a list of providers that have valid API keys configured
 *
 * @returns Array of provider IDs that are ready to use
 */
export function getConfiguredProviders(): Array<keyof typeof PROVIDER_FACTORIES> {
  return Object.keys(PROVIDER_FACTORIES).filter((provider) =>
    hasApiKey(provider as keyof typeof PROVIDER_FACTORIES)
  ) as Array<keyof typeof PROVIDER_FACTORIES>
}

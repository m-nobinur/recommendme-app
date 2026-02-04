/**
 * Available AI providers
 */
export const AI_PROVIDERS = ['gateway', 'gemini', 'openai', 'openrouter', 'groq'] as const

/**
 * Available model tiers
 */
export const MODEL_TIERS = ['smartest', 'smart', 'regular'] as const

/**
 * Type for AI providers
 */
export type AIProviderType = (typeof AI_PROVIDERS)[number]

/**
 * Type for model tiers
 */
export type ModelTierType = (typeof MODEL_TIERS)[number]

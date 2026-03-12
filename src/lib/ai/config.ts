import { z } from 'zod'
import { AI_PROVIDERS, MODEL_TIERS } from './config/constants'
import type { AIProvider, ModelTier } from './providers'

/**
 * AI Configuration Schema
 * Validates all AI-related configuration with Zod
 */
const aiConfigSchema = z.object({
  /** Default AI provider for chat and general tasks */
  defaultProvider: z.enum(AI_PROVIDERS),

  /** Default model tier for chat */
  defaultTier: z.enum(MODEL_TIERS),

  /** Default temperature for chat (0.0 = deterministic, 1.0 = creative) */
  defaultTemperature: z.number().min(0).max(2).default(0.7),

  /** Maximum number of tool calling steps allowed */
  maxToolSteps: z.number().min(1).max(10).default(5),

  /** Enable debug logging in development */
  debug: z.boolean().default(false),

  /** Chat-specific configuration */
  chat: z.object({
    provider: z.enum(AI_PROVIDERS).optional(),
    tier: z.enum(MODEL_TIERS).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxSteps: z.number().min(1).max(10).optional(),
  }),

  /** Suggestion generation configuration */
  suggestions: z.object({
    provider: z.enum(AI_PROVIDERS).optional(),
    tier: z.enum(MODEL_TIERS).optional(),
    temperature: z.number().min(0).max(2).optional(),
    promptVersion: z.string().default('v2'),
    minSuggestions: z.number().min(1).max(10).default(2),
    maxSuggestions: z.number().min(1).max(10).default(4),
    maxWordsPerSuggestion: z.number().min(3).max(20).default(8),
    /** Character limit for AI response context */
    responseContextLimit: z.number().min(100).max(2000).default(500),
  }),

  /** Prompt version configuration */
  prompts: z.object({
    systemVersion: z.string().default('v1'),
    suggestionVersion: z.string().default('v2'),
  }),

  /** Feature flags */
  features: z.object({
    enableMemory: z.boolean().default(false),
    enableMessagePersistence: z.boolean().default(false),
    enableAnalytics: z.boolean().default(false),
    enablePromptABTesting: z.boolean().default(false),
  }),

  /** Performance settings */
  performance: z.object({
    enableStreaming: z.boolean().default(true),
    requestTimeout: z.number().min(1000).max(300000).default(60000),
    enableCaching: z.boolean().default(false),
    cacheTTL: z.number().min(60).max(86400).default(3600),
    memoryEmbeddingCacheTTL: z.number().min(10).max(3600).default(120),
    memoryRetrievalCacheTTL: z.number().min(10).max(3600).default(60),
  }),
})

/**
 * Type inference from schema
 */
export type AIConfig = z.infer<typeof aiConfigSchema>

/**
 * Environment variable mapping
 * Maps env vars to config paths
 */
const ENV_VAR_MAP = {
  // Providers and tiers
  AI_DEFAULT_PROVIDER: 'defaultProvider',
  AI_DEFAULT_TIER: 'defaultTier',
  AI_DEFAULT_TEMPERATURE: 'defaultTemperature',
  AI_MAX_TOOL_STEPS: 'maxToolSteps',

  // Chat
  AI_CHAT_PROVIDER: 'chat.provider',
  AI_CHAT_TIER: 'chat.tier',
  AI_CHAT_TEMPERATURE: 'chat.temperature',
  AI_CHAT_MAX_STEPS: 'chat.maxSteps',

  // Suggestions
  AI_SUGGESTIONS_PROVIDER: 'suggestions.provider',
  AI_SUGGESTIONS_TIER: 'suggestions.tier',
  AI_SUGGESTIONS_TEMPERATURE: 'suggestions.temperature',
  AI_SUGGESTIONS_PROMPT_VERSION: 'suggestions.promptVersion',
  AI_SUGGESTIONS_MIN: 'suggestions.minSuggestions',
  AI_SUGGESTIONS_MAX: 'suggestions.maxSuggestions',
  AI_SUGGESTIONS_MAX_WORDS: 'suggestions.maxWordsPerSuggestion',
  AI_SUGGESTIONS_CONTEXT_LIMIT: 'suggestions.responseContextLimit',

  // Prompts
  AI_SYSTEM_PROMPT_VERSION: 'prompts.systemVersion',
  AI_SUGGESTION_PROMPT_VERSION: 'prompts.suggestionVersion',

  // Features
  AI_ENABLE_MEMORY: 'features.enableMemory',
  AI_ENABLE_MESSAGE_PERSISTENCE: 'features.enableMessagePersistence',
  AI_ENABLE_ANALYTICS: 'features.enableAnalytics',
  AI_ENABLE_PROMPT_AB_TESTING: 'features.enablePromptABTesting',

  // Performance
  AI_ENABLE_STREAMING: 'performance.enableStreaming',
  AI_REQUEST_TIMEOUT: 'performance.requestTimeout',
  AI_ENABLE_CACHING: 'performance.enableCaching',
  AI_CACHE_TTL: 'performance.cacheTTL',
  AI_MEMORY_EMBEDDING_CACHE_TTL: 'performance.memoryEmbeddingCacheTTL',
  AI_MEMORY_RETRIEVAL_CACHE_TTL: 'performance.memoryRetrievalCacheTTL',

  // Debug
  AI_DEBUG: 'debug',
} as const

/**
 * Default AI configuration
 * These are the fallback values when env vars are not set
 */
const DEFAULT_CONFIG: AIConfig = {
  defaultProvider: 'gemini',
  defaultTier: 'smart',
  defaultTemperature: 0.7,
  maxToolSteps: 5,
  debug: false,

  chat: {
    provider: undefined, // Inherits from defaultProvider
    tier: undefined, // Inherits from defaultTier
    temperature: undefined, // Inherits from defaultTemperature
    maxSteps: undefined, // Inherits from maxToolSteps
  },

  suggestions: {
    provider: undefined, // Defaults to 'gemini'
    tier: undefined, // Defaults to 'regular'
    temperature: undefined, // Defaults to 0.7
    promptVersion: 'v2',
    minSuggestions: 2,
    maxSuggestions: 4,
    maxWordsPerSuggestion: 8,
    responseContextLimit: 500,
  },

  prompts: {
    systemVersion: 'v1',
    suggestionVersion: 'v2',
  },

  features: {
    enableMemory: false,
    enableMessagePersistence: false,
    enableAnalytics: false,
    enablePromptABTesting: false,
  },

  performance: {
    enableStreaming: true,
    requestTimeout: 60000, // 60 seconds
    enableCaching: false,
    cacheTTL: 3600, // 1 hour
    memoryEmbeddingCacheTTL: 120, // 2 minutes
    memoryRetrievalCacheTTL: 60, // 1 minute
  },
}

/**
 * Parse environment variable value
 * Handles string to appropriate type conversion
 */
function parseEnvValue(value: string | undefined, type: 'string' | 'number' | 'boolean'): unknown {
  if (value === undefined) return undefined

  switch (type) {
    case 'number': {
      const num = Number(value)
      return Number.isNaN(num) ? undefined : num
    }
    case 'boolean':
      return value.toLowerCase() === 'true'
    default:
      return value
  }
}

/**
 * Set nested property by path
 * Example: setNestedProperty(obj, 'chat.provider', 'openai')
 */
function setNestedProperty(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.')
  let current = obj

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (!(key in current)) {
      current[key] = {}
    }
    current = current[key] as Record<string, unknown>
  }

  const lastKey = keys[keys.length - 1]
  current[lastKey] = value
}

/**
 * Type hints for environment variable parsing
 * Maps env var names to their expected types
 */
const TYPE_HINTS: Record<string, 'string' | 'number' | 'boolean'> = {
  AI_DEFAULT_PROVIDER: 'string',
  AI_DEFAULT_TIER: 'string',
  AI_DEFAULT_TEMPERATURE: 'number',
  AI_MAX_TOOL_STEPS: 'number',
  AI_CHAT_PROVIDER: 'string',
  AI_CHAT_TIER: 'string',
  AI_CHAT_TEMPERATURE: 'number',
  AI_CHAT_MAX_STEPS: 'number',
  AI_SUGGESTIONS_PROVIDER: 'string',
  AI_SUGGESTIONS_TIER: 'string',
  AI_SUGGESTIONS_TEMPERATURE: 'number',
  AI_SUGGESTIONS_PROMPT_VERSION: 'string',
  AI_SUGGESTIONS_MIN: 'number',
  AI_SUGGESTIONS_MAX: 'number',
  AI_SUGGESTIONS_MAX_WORDS: 'number',
  AI_SUGGESTIONS_CONTEXT_LIMIT: 'number',
  AI_SYSTEM_PROMPT_VERSION: 'string',
  AI_SUGGESTION_PROMPT_VERSION: 'string',
  AI_ENABLE_MEMORY: 'boolean',
  AI_ENABLE_MESSAGE_PERSISTENCE: 'boolean',
  AI_ENABLE_ANALYTICS: 'boolean',
  AI_ENABLE_PROMPT_AB_TESTING: 'boolean',
  AI_ENABLE_STREAMING: 'boolean',
  AI_REQUEST_TIMEOUT: 'number',
  AI_ENABLE_CACHING: 'boolean',
  AI_CACHE_TTL: 'number',
  AI_MEMORY_EMBEDDING_CACHE_TTL: 'number',
  AI_MEMORY_RETRIEVAL_CACHE_TTL: 'number',
  AI_DEBUG: 'boolean',
}

/**
 * Load configuration from environment variables
 * Merges env vars with defaults
 */
function loadConfigFromEnv(): AIConfig {
  const config = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>

  for (const [envVar, configPath] of Object.entries(ENV_VAR_MAP)) {
    const value = process.env[envVar]
    if (value !== undefined) {
      const type = TYPE_HINTS[envVar] || 'string'
      const parsedValue = parseEnvValue(value, type)
      if (parsedValue !== undefined) {
        setNestedProperty(config, configPath, parsedValue)
      }
    }
  }

  if (process.env.NODE_ENV === 'development' && !config.debug) {
    config.debug = true
  }

  try {
    return aiConfigSchema.parse(config)
  } catch (error) {
    console.error('[Reme:Config] Configuration validation failed:', error)
    if (error instanceof z.ZodError) {
      console.error('[Reme:Config] Validation errors:', JSON.stringify(error.issues, null, 2))
    }
    throw new Error(
      'AI configuration validation failed. Check environment variables and see logs for details.'
    )
  }
}

/**
 * Cached configuration instance
 * Loaded once at module initialization
 */
let cachedConfig: AIConfig | null = null

/**
 * Get the current AI configuration
 * Configuration is loaded once and cached
 *
 * @returns Validated AI configuration
 */
export function getAIConfig(): AIConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfigFromEnv()
  }
  return cachedConfig
}

/**
 * Reset cached configuration
 * Useful for testing or hot-reloading
 */
export function resetAIConfig(): void {
  cachedConfig = null
}

/**
 * Get configuration for chat
 * Returns chat-specific config with fallbacks to defaults
 */
export function getChatConfig() {
  const config = getAIConfig()
  return {
    provider: (config.chat.provider || config.defaultProvider) as AIProvider,
    tier: (config.chat.tier || config.defaultTier) as ModelTier,
    temperature: config.chat.temperature ?? config.defaultTemperature,
    maxSteps: config.chat.maxSteps ?? config.maxToolSteps,
    debug: config.debug,
  }
}

/**
 * Get configuration for suggestions
 * Returns suggestion-specific config with optimized defaults
 */
export function getSuggestionsConfig() {
  const config = getAIConfig()
  return {
    provider: (config.suggestions.provider || 'gemini') as AIProvider,
    tier: (config.suggestions.tier || 'regular') as ModelTier,
    temperature: config.suggestions.temperature ?? 0.7,
    promptVersion: config.suggestions.promptVersion,
    minSuggestions: config.suggestions.minSuggestions,
    maxSuggestions: config.suggestions.maxSuggestions,
    maxWordsPerSuggestion: config.suggestions.maxWordsPerSuggestion,
    responseContextLimit: config.suggestions.responseContextLimit,
    debug: config.debug,
  }
}

/**
 * Get configuration for prompts
 */
export function getPromptsConfig() {
  const config = getAIConfig()
  return {
    systemVersion: config.prompts.systemVersion,
    suggestionVersion: config.prompts.suggestionVersion,
  }
}

/**
 * Get feature flags
 */
export function getFeatureFlags() {
  const config = getAIConfig()
  return config.features
}

/**
 * Get performance settings
 */
export function getPerformanceConfig() {
  const config = getAIConfig()
  return config.performance
}

/**
 * Check if a specific feature is enabled
 */
export function isFeatureEnabled(feature: keyof AIConfig['features']): boolean {
  const flags = getFeatureFlags()
  return flags[feature]
}

/**
 * Log current configuration (debug only)
 * Useful for troubleshooting
 */
export function logAIConfig(): void {
  const config = getAIConfig()
  if (config.debug) {
    console.log('[Reme:AI] Configuration:', {
      defaultProvider: config.defaultProvider,
      defaultTier: config.defaultTier,
      chat: getChatConfig(),
      suggestions: getSuggestionsConfig(),
      features: getFeatureFlags(),
      performance: getPerformanceConfig(),
    })
  }
}

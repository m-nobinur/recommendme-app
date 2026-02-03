import type { AIProvider, ModelTier, ProviderConfig, TierInfo } from '@/lib/ai/providers/types'

/**
 * AI Gateway (Vercel) Provider Configuration
 * Unified interface to multiple AI providers with automatic fallback
 */
export const AI_GATEWAY_CONFIG: ProviderConfig = {
  id: 'gateway',
  name: 'AI Gateway',
  description: 'Vercel AI Gateway with multi-provider support and automatic fallback',
  docsUrl: 'https://vercel.com/docs/ai-gateway',
  requiresApiKey: false,
  apiKeyEnvVar: 'AI_GATEWAY_API_KEY',
  baseURL: 'https://ai-gateway.vercel.sh/v3/ai',
  models: {
    smartest: {
      id: 'google/gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      description: 'Most capable model for complex reasoning',
      contextWindow: 1000000,
      supportsImages: true,
      supportsTools: true,
      supportsStructuredOutput: true,
    },
    smart: {
      id: 'google/gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      description: 'Best balance of speed and intelligence',
      contextWindow: 1000000,
      supportsImages: true,
      supportsTools: true,
      supportsStructuredOutput: true,
    },
    regular: {
      id: 'google/gemini-2.5-flash-lite',
      name: 'Gemini 2.5 Flash Lite',
      description: 'Ultra-fast for simple tasks',
      contextWindow: 1000000,
      supportsImages: true,
      supportsTools: true,
      supportsStructuredOutput: true,
    },
  },
}

/**
 * Google Gemini Direct Provider Configuration
 * Direct connection to Google's Gemini API
 */
export const GEMINI_CONFIG: ProviderConfig = {
  id: 'gemini',
  name: 'Google Gemini',
  description: 'Direct access to Google Gemini models',
  docsUrl: 'https://ai.google.dev/gemini-api/docs',
  requiresApiKey: true,
  apiKeyEnvVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta',
  models: {
    smartest: {
      id: 'gemini-3-flash-preview',
      name: 'Gemini 3 Flash Preview',
      description: 'Latest preview with frontier capabilities',
      contextWindow: 1000000,
      supportsImages: true,
      supportsTools: true,
      supportsStructuredOutput: true,
    },
    smart: {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      description: 'Production-ready with excellent performance',
      contextWindow: 1000000,
      supportsImages: true,
      supportsTools: true,
      supportsStructuredOutput: true,
    },
    regular: {
      id: 'gemini-2.5-flash-lite',
      name: 'Gemini 2.5 Flash Lite',
      description: 'Cost-effective for high-volume applications',
      contextWindow: 1000000,
      supportsImages: true,
      supportsTools: true,
      supportsStructuredOutput: true,
    },
  },
}

/**
 * OpenAI Provider Configuration
 * Access to GPT models including o1/o3 reasoning models
 */
export const OPENAI_CONFIG: ProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  description: 'GPT models including advanced reasoning capabilities',
  docsUrl: 'https://platform.openai.com/docs',
  requiresApiKey: true,
  apiKeyEnvVar: 'OPENAI_API_KEY',
  baseURL: 'https://api.openai.com/v1',
  models: {
    smartest: {
      id: 'gpt-5',
      name: 'GPT-5',
      description: 'Most capable OpenAI model with advanced reasoning',
      contextWindow: 128000,
      supportsImages: true,
      supportsTools: true,
      supportsStructuredOutput: true,
    },
    smart: {
      id: 'gpt-5-mini',
      name: 'GPT-5 Mini',
      description: 'Fast and cost-effective flagship model',
      contextWindow: 128000,
      supportsImages: true,
      supportsTools: true,
      supportsStructuredOutput: true,
    },
    regular: {
      id: 'gpt-5-nano',
      name: 'GPT-5 Nano',
      description: 'Smallest and fastest GPT-5 variant',
      contextWindow: 128000,
      supportsImages: true,
      supportsTools: true,
      supportsStructuredOutput: true,
    },
  },
}

/**
 * OpenRouter Provider Configuration
 * Access to 100+ models from multiple providers
 * Universal API gateway with transparent pricing and automatic failover
 */
export const OPENROUTER_CONFIG: ProviderConfig = {
  id: 'openrouter',
  name: 'OpenRouter',
  description: 'Universal API gateway for 100+ AI models with transparent pricing',
  docsUrl: 'https://openrouter.ai/docs',
  requiresApiKey: true,
  apiKeyEnvVar: 'OPENROUTER_API_KEY',
  baseURL: 'https://openrouter.ai/api/v1',
  models: {
    smartest: {
      id: 'anthropic/claude-3.5-sonnet',
      name: 'Claude 3.5 Sonnet (via OpenRouter)',
      description: 'Best reasoning and coding capabilities',
      contextWindow: 200000,
      supportsImages: true,
      supportsTools: true,
      supportsStructuredOutput: true,
    },
    smart: {
      id: 'openai/gpt-4o',
      name: 'GPT-4o (via OpenRouter)',
      description: 'Fast and capable multimodal model',
      contextWindow: 128000,
      supportsImages: true,
      supportsTools: true,
      supportsStructuredOutput: true,
    },
    regular: {
      id: 'openai/gpt-4o-mini',
      name: 'GPT-4o Mini (via OpenRouter)',
      description: 'Cost-effective for high-volume tasks',
      contextWindow: 128000,
      supportsImages: true,
      supportsTools: true,
      supportsStructuredOutput: true,
    },
  },
}

/**
 * Groq Provider Configuration
 * Ultra-fast inference with LPU technology
 */
export const GROQ_CONFIG: ProviderConfig = {
  id: 'groq',
  name: 'Groq',
  description: 'Ultra-fast inference with LPU technology',
  docsUrl: 'https://console.groq.com/docs',
  requiresApiKey: true,
  apiKeyEnvVar: 'GROQ_API_KEY',
  baseURL: 'https://api.groq.com/openai/v1',
  models: {
    smartest: {
      id: 'llama-3.3-70b-versatile',
      name: 'Llama 3.3 70B',
      description: 'Most capable open model on Groq',
      contextWindow: 128000,
      supportsImages: false,
      supportsTools: true,
      supportsStructuredOutput: true,
    },
    smart: {
      id: 'llama-3.1-8b-instant',
      name: 'Llama 3.1 8B Instant',
      description: 'Lightning-fast responses',
      contextWindow: 128000,
      supportsImages: false,
      supportsTools: true,
      supportsStructuredOutput: true,
    },
    regular: {
      id: 'gemma2-9b-it',
      name: 'Gemma 2 9B',
      description: 'Efficient Google model on Groq',
      contextWindow: 8192,
      supportsImages: false,
      supportsTools: true,
      supportsStructuredOutput: true,
    },
  },
}

/**
 * All provider configurations
 */
export const PROVIDER_CONFIGS: Record<AIProvider, ProviderConfig> = {
  gateway: AI_GATEWAY_CONFIG,
  gemini: GEMINI_CONFIG,
  openai: OPENAI_CONFIG,
  openrouter: OPENROUTER_CONFIG,
  groq: GROQ_CONFIG,
}

/**
 * Model tier information for UI display
 */
export const TIER_INFO: Record<ModelTier, TierInfo> = {
  smartest: {
    name: 'Smartest',
    description: 'Maximum intelligence for complex reasoning',
    costLevel: 3,
    speedLevel: 3,
    intelligenceLevel: 1,
  },
  smart: {
    name: 'Smart',
    description: 'Balanced performance and cost',
    costLevel: 2,
    speedLevel: 2,
    intelligenceLevel: 2,
  },
  regular: {
    name: 'Regular',
    description: 'Fast and economical',
    costLevel: 1,
    speedLevel: 1,
    intelligenceLevel: 3,
  },
}

/**
 * Default provider and tier
 */
export const DEFAULT_PROVIDER: AIProvider = 'gemini'
export const DEFAULT_TIER: ModelTier = 'smart'

/**
 * Validation functions
 */

const VALID_PROVIDERS: readonly AIProvider[] = [
  'gateway',
  'gemini',
  'openai',
  'openrouter',
  'groq',
] as const

const VALID_TIERS: readonly ModelTier[] = ['smartest', 'smart', 'regular'] as const

/**
 * Type guard to check if a value is a valid provider
 */
export function isValidProvider(value: unknown): value is AIProvider {
  return typeof value === 'string' && VALID_PROVIDERS.includes(value as AIProvider)
}

/**
 * Type guard to check if a value is a valid tier
 */
export function isValidTier(value: unknown): value is ModelTier {
  return typeof value === 'string' && VALID_TIERS.includes(value as ModelTier)
}

/**
 * Get provider name from ID
 */
export function getProviderName(provider: AIProvider): string {
  return PROVIDER_CONFIGS[provider]?.name ?? provider
}

/**
 * Get tier display name
 */
export function getTierName(tier: ModelTier): string {
  return TIER_INFO[tier]?.name ?? tier
}

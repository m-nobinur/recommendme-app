/**
 * Supported AI providers
 */
export type AIProvider = 'gateway' | 'gemini' | 'openai' | 'openrouter' | 'groq'

/**
 * Model tiers for different capability levels
 */
export type ModelTier = 'smartest' | 'smart' | 'regular'

/**
 * Individual model configuration
 */
export interface ModelConfig {
  id: string
  name: string
  description: string
  contextWindow?: number
  supportsImages?: boolean
  supportsTools?: boolean
  supportsStructuredOutput?: boolean
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: AIProvider
  name: string
  description: string
  docsUrl: string
  requiresApiKey: boolean
  apiKeyEnvVar?: string
  baseURL?: string
  models: Record<ModelTier, ModelConfig>
}

/**
 * Tier information for display
 */
export interface TierInfo {
  name: string
  description: string
  /** Relative cost level (1-3, 1 = cheapest) */
  costLevel: 1 | 2 | 3
  /** Relative speed level (1-3, 1 = fastest) */
  speedLevel: 1 | 2 | 3
  /** Relative intelligence level (1-3, 1 = most intelligent) */
  intelligenceLevel: 1 | 2 | 3
}

/**
 * Provider-specific options (for advanced usage)
 */
export interface ProviderOptions {
  gateway?: {
    order?: string[]
    only?: string[]
    user?: string
    tags?: string[]
  }
  gemini?: {
    cachedContent?: string
    structuredOutputs?: boolean
    safetySettings?: Array<{
      category:
        | 'HARM_CATEGORY_UNSPECIFIED'
        | 'HARM_CATEGORY_HATE_SPEECH'
        | 'HARM_CATEGORY_DANGEROUS_CONTENT'
        | 'HARM_CATEGORY_HARASSMENT'
        | 'HARM_CATEGORY_SEXUALLY_EXPLICIT'
        | 'HARM_CATEGORY_CIVIC_INTEGRITY'
      threshold:
        | 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
        | 'BLOCK_LOW_AND_ABOVE'
        | 'BLOCK_MEDIUM_AND_ABOVE'
        | 'BLOCK_ONLY_HIGH'
        | 'BLOCK_NONE'
        | 'OFF'
    }>
    responseModalities?: string[]
    thinkingConfig?: {
      thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high'
      thinkingBudget?: number
      includeThoughts?: boolean
    }
    imageConfig?: {
      aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9'
      imageSize?: '1K' | '2K' | '4K'
    }
    audioTimestamp?: boolean
    mediaResolution?:
      | 'MEDIA_RESOLUTION_UNSPECIFIED'
      | 'MEDIA_RESOLUTION_LOW'
      | 'MEDIA_RESOLUTION_MEDIUM'
      | 'MEDIA_RESOLUTION_HIGH'
    labels?: Record<string, string>
    threshold?: string
    retrievalConfig?: {
      latLng?: {
        latitude: number
        longitude: number
      }
    }
  }
  openai?: {
    reasoningEffort?: 'low' | 'medium' | 'high'
    user?: string
    serviceTier?: 'auto' | 'flex' | 'priority' | 'default'
  }
  openrouter?: {
    transforms?: string[]
    models?: string[]
    route?: 'fallback'
    provider?: {
      order?: string[]
      allow_fallbacks?: boolean
      require_parameters?: boolean
      data_collection?: 'deny' | 'allow'
    }
  }
  groq?: {
    reasoningFormat?: 'parsed' | 'raw' | 'hidden'
    user?: string
  }
}

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
  /** Model identifier */
  id: string
  /** Display name */
  name: string
  /** Description of model capabilities */
  description: string
  /** Context window size in tokens */
  contextWindow?: number
  /** Whether the model supports image input */
  supportsImages?: boolean
  /** Whether the model supports tool calling */
  supportsTools?: boolean
  /** Whether the model supports structured output */
  supportsStructuredOutput?: boolean
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  /** Provider identifier */
  id: AIProvider
  /** Display name */
  name: string
  /** Description */
  description: string
  /** Documentation URL */
  docsUrl: string
  /** Whether an API key is required */
  requiresApiKey: boolean
  /** Environment variable name for API key */
  apiKeyEnvVar?: string
  /** Base URL for API calls (if applicable) */
  baseURL?: string
  /** Models organized by tier */
  models: Record<ModelTier, ModelConfig>
}

/**
 * Tier information for display
 */
export interface TierInfo {
  /** Display name */
  name: string
  /** Description */
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
    /** Provider order preference */
    order?: string[]
    /** Restrict to specific providers */
    only?: string[]
    /** User identifier for tracking */
    user?: string
    /** Tags for categorization */
    tags?: string[]
  }
  gemini?: {
    /** Cached content reference for context reuse */
    cachedContent?: string
    /** Enable structured output (default: true) */
    structuredOutputs?: boolean
    /** Safety settings */
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
    /** Response modalities (TEXT, IMAGE) */
    responseModalities?: string[]
    /** Thinking configuration for reasoning models */
    thinkingConfig?: {
      /** Thinking level for Gemini 3 models */
      thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high'
      /** Thinking budget for Gemini 2.5 models */
      thinkingBudget?: number
      /** Include thought summaries in response */
      includeThoughts?: boolean
    }
    /** Image generation configuration */
    imageConfig?: {
      aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9'
      imageSize?: '1K' | '2K' | '4K'
    }
    /** Enable audio timestamp understanding */
    audioTimestamp?: boolean
    /** Media resolution setting */
    mediaResolution?:
      | 'MEDIA_RESOLUTION_UNSPECIFIED'
      | 'MEDIA_RESOLUTION_LOW'
      | 'MEDIA_RESOLUTION_MEDIUM'
      | 'MEDIA_RESOLUTION_HIGH'
    /** Labels for billing (Vertex AI only) */
    labels?: Record<string, string>
    /** Standalone threshold setting */
    threshold?: string
    /** Location context for grounding tools */
    retrievalConfig?: {
      latLng?: {
        latitude: number
        longitude: number
      }
    }
  }
  openai?: {
    /** Reasoning effort for o1/o3 models */
    reasoningEffort?: 'low' | 'medium' | 'high'
    /** User identifier */
    user?: string
    /** Service tier */
    serviceTier?: 'auto' | 'flex' | 'priority' | 'default'
  }
  openrouter?: {
    /** Transforms for request/response modification */
    transforms?: string[]
    /** Models to use for routing and fallback */
    models?: string[]
    /** Route type preference */
    route?: 'fallback'
    /** Provider order for routing */
    provider?: {
      order?: string[]
      allow_fallbacks?: boolean
      require_parameters?: boolean
      data_collection?: 'deny' | 'allow'
    }
  }
  groq?: {
    /** Reasoning format */
    reasoningFormat?: 'parsed' | 'raw' | 'hidden'
    /** User identifier */
    user?: string
  }
}

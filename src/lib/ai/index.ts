/**
 * AI Module - Centralized AI functionality
 *
 * This module provides a unified interface for all AI-related functionality:
 * - Config: Centralized configuration from environment variables
 * - Providers: Multi-provider support with automatic fallback
 * - Prompts: Versioned prompts for system and specialized tasks
 * - Tools: CRM tools for AI agent interactions
 * - Services: Reusable AI services (suggestions, etc.)
 * - Utilities: Request IDs, retry logic, rate limiting, monitoring
 */

// Configuration
export {
  type AIConfig,
  getAIConfig,
  getChatConfig,
  getFeatureFlags,
  getPerformanceConfig,
  getPromptsConfig,
  getSuggestionsConfig,
  isFeatureEnabled,
  logAIConfig,
  resetAIConfig,
} from './config'

export {
  AI_PROVIDERS,
  type AIProviderType,
  MODEL_TIERS,
  type ModelTierType,
} from './config/constants'

export {
  getActiveSuggestionPromptVersion,
  getActiveSystemPromptVersion,
} from './config/versions'

// Prompts
export {
  clearTemplateCache,
  DEFAULT_SUGGESTION_CONFIG,
  getPromptVersion,
  getSuggestionPrompt,
  getSuggestionPromptVersion,
  getSystemPrompt,
  listPromptVersions,
  listSuggestionPromptVersions,
  type PromptVersion,
  SUGGESTION_PROMPTS,
  type SuggestionConfig,
  SYSTEM_PROMPTS,
} from './prompts'

// Providers
export {
  type AIProvider,
  createAIProvider,
  DEFAULT_PROVIDER,
  DEFAULT_TIER,
  getAvailableProviders,
  getConfiguredProviders,
  getModelId,
  hasApiKey,
  isValidProvider,
  isValidTier,
  type ModelConfig,
  type ModelTier,
  PROVIDER_CONFIGS,
  type ProviderConfig,
  providerConfigs,
  providers,
  TIER_INFO,
} from './providers'

// Services
export {
  type GenerateSuggestionsOptions,
  generateSuggestions,
  isSuggestionError,
  isSuggestionResult,
  type SuggestionError,
  type SuggestionResult,
} from './services'

// Tools
export { type CRMTools, createCRMTools, type ToolContext } from './tools'

// Utilities
export {
  checkRateLimit,
  clearMetrics,
  clearRateLimits,
  createChildRequestId,
  generateRequestId,
  getBaseRequestId,
  getMetrics,
  getRateLimitStatus,
  getStatistics,
  isRetryableError,
  logStatistics,
  type OperationMetrics,
  type RateLimitConfig,
  type RetryOptions,
  recordError,
  recordSuccess,
  resetRateLimit,
  startOperation,
  withRetry,
} from './utils'

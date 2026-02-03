import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'
import { createGateway } from 'ai'
import { validateApiKey } from '@/lib/ai/providers/env'
import {
  AI_GATEWAY_CONFIG,
  GEMINI_CONFIG,
  GROQ_CONFIG,
  OPENAI_CONFIG,
  OPENROUTER_CONFIG,
} from './config'

/**
 * Creates an AI Gateway provider instance
 * AI Gateway provides unified access to multiple providers with automatic fallback
 *
 * @param modelId - Model identifier in format "provider/model-name"
 * @returns Configured LanguageModel
 * @throws Error if modelId is invalid
 *
 * @example
 * ```ts
 * const model = createGatewayProvider('google/gemini-2.5-flash')
 * ```
 */
export function createGatewayProvider(modelId: string): LanguageModel {
  if (!modelId || typeof modelId !== 'string') {
    throw new Error('Invalid model ID for AI Gateway')
  }

  // AI Gateway can work without an API key on Vercel (OIDC auth)
  const envVar = AI_GATEWAY_CONFIG.apiKeyEnvVar
  const apiKey = envVar ? process.env[envVar] : undefined

  const gateway = createGateway({
    apiKey: apiKey || undefined,
    baseURL: AI_GATEWAY_CONFIG.baseURL,
  })

  return gateway(modelId)
}

/**
 * Creates a Google Gemini provider instance
 * Direct connection to Google's Gemini API
 *
 * @param modelId - Gemini model identifier (e.g., 'gemini-2.5-flash')
 * @returns Configured LanguageModel
 * @throws Error if API key is missing or invalid
 *
 * @example
 * ```ts
 * const model = createGeminiProvider('gemini-2.5-flash')
 * ```
 */
export function createGeminiProvider(modelId: string): LanguageModel {
  if (!modelId || typeof modelId !== 'string') {
    throw new Error('Invalid model ID for Gemini')
  }

  const envVar = GEMINI_CONFIG.apiKeyEnvVar
  if (!envVar) {
    throw new Error('Missing API key environment variable configuration for Gemini')
  }

  const apiKey = validateApiKey(envVar, 'Google Gemini')

  const google = createGoogleGenerativeAI({
    apiKey,
    baseURL: GEMINI_CONFIG.baseURL,
  })

  return google(modelId)
}

/**
 * Creates an OpenAI provider instance
 * Access to GPT models including reasoning models
 *
 * @param modelId - OpenAI model identifier (e.g., 'gpt-5', 'gpt-5-mini')
 * @returns Configured LanguageModel
 * @throws Error if API key is missing or invalid
 *
 * @example
 * ```ts
 * const model = createOpenAIProvider('gpt-5-mini')
 * ```
 */
export function createOpenAIProvider(modelId: string): LanguageModel {
  if (!modelId || typeof modelId !== 'string') {
    throw new Error('Invalid model ID for OpenAI')
  }

  const envVar = OPENAI_CONFIG.apiKeyEnvVar
  if (!envVar) {
    throw new Error('Missing API key environment variable configuration for OpenAI')
  }

  const apiKey = validateApiKey(envVar, 'OpenAI')

  const openai = createOpenAI({
    apiKey,
    baseURL: OPENAI_CONFIG.baseURL,
  })

  return openai(modelId)
}

/**
 * Creates an OpenRouter provider instance
 * Access to 100+ models from multiple providers
 *
 * @param modelId - Model identifier in OpenRouter format (e.g., 'anthropic/claude-3.5-sonnet')
 * @returns Configured LanguageModel
 * @throws Error if API key is missing or invalid
 *
 * @example
 * ```ts
 * const model = createOpenRouterProvider('anthropic/claude-3.5-sonnet')
 * ```
 */
export function createOpenRouterProvider(modelId: string): LanguageModel {
  if (!modelId || typeof modelId !== 'string') {
    throw new Error('Invalid model ID for OpenRouter')
  }

  const envVar = OPENROUTER_CONFIG.apiKeyEnvVar
  if (!envVar) {
    throw new Error('Missing API key environment variable configuration for OpenRouter')
  }

  const apiKey = validateApiKey(envVar, 'OpenRouter')

  const openrouter = createOpenRouter({
    apiKey,
  })

  return openrouter.chat(modelId)
}

/**
 * Creates a Groq provider instance
 * Ultra-fast inference with LPU technology
 *
 * @param modelId - Groq model identifier
 * @returns Configured LanguageModel
 * @throws Error if API key is missing or invalid
 *
 * @example
 * ```ts
 * const model = createGroqProvider('llama-3.1-8b-instant')
 * ```
 */
export function createGroqProvider(modelId: string): LanguageModel {
  if (!modelId || typeof modelId !== 'string') {
    throw new Error('Invalid model ID for Groq')
  }

  const envVar = GROQ_CONFIG.apiKeyEnvVar
  if (!envVar) {
    throw new Error('Missing API key environment variable configuration for Groq')
  }

  const apiKey = validateApiKey(envVar, 'Groq')

  const groq = createGroq({
    apiKey,
    baseURL: GROQ_CONFIG.baseURL,
  })

  return groq(modelId)
}

/**
 * Provider factory type for registry
 */
export type ProviderFactory = (modelId: string) => LanguageModel

/**
 * Provider factory registry
 * Maps provider IDs to their factory functions
 */
export const PROVIDER_FACTORY_REGISTRY: Record<string, ProviderFactory> = {
  gateway: createGatewayProvider,
  gemini: createGeminiProvider,
  openai: createOpenAIProvider,
  openrouter: createOpenRouterProvider,
  groq: createGroqProvider,
}

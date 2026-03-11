/**
 * Static pricing table for AI models used in the system.
 * Prices are per 1M tokens (USD) as of March 2026.
 * Source: OpenAI, OpenRouter, Google pricing pages.
 */

export interface ModelPricing {
  inputPerMillion: number
  outputPerMillion: number
  provider: string
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    provider: 'openai',
  },
  'openai/gpt-4o-mini': {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    provider: 'openrouter',
  },
  'gpt-4o': {
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
    provider: 'openai',
  },
  'openai/gpt-4o': {
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
    provider: 'openrouter',
  },
  'text-embedding-3-large': {
    inputPerMillion: 0.13,
    outputPerMillion: 0,
    provider: 'openai',
  },
  'text-embedding-3-small': {
    inputPerMillion: 0.02,
    outputPerMillion: 0,
    provider: 'openai',
  },
  'gemini-2.0-flash': {
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
    provider: 'google',
  },
  'gemini-1.5-pro': {
    inputPerMillion: 1.25,
    outputPerMillion: 5.0,
    provider: 'google',
  },
}

const MODEL_ALIASES: Record<string, string> = {
  'openai/text-embedding-3-large': 'text-embedding-3-large',
  'openai/text-embedding-3-small': 'text-embedding-3-small',
}

const MODEL_FAMILY_FALLBACKS: Array<{ pattern: RegExp; fallbackModel: string }> = [
  { pattern: /(?:^|\/)gpt-4\.1-mini$/i, fallbackModel: 'gpt-4o-mini' },
  { pattern: /(?:^|\/)gpt-4\.1-nano$/i, fallbackModel: 'gpt-4o-mini' },
  { pattern: /(?:^|\/)gpt-4\.1$/i, fallbackModel: 'gpt-4o' },
  { pattern: /(?:^|\/)gpt-5-mini$/i, fallbackModel: 'gpt-4o-mini' },
  { pattern: /(?:^|\/)gpt-5-nano$/i, fallbackModel: 'gpt-4o-mini' },
  { pattern: /(?:^|\/)gpt-5$/i, fallbackModel: 'gpt-4o' },
  { pattern: /(?:^|\/)gemini-2\.5-pro$/i, fallbackModel: 'gemini-1.5-pro' },
  { pattern: /(?:^|\/)gemini-2\.5-flash(?:-lite)?$/i, fallbackModel: 'gemini-2.0-flash' },
  { pattern: /(?:^|\/)gemini-3-flash-preview$/i, fallbackModel: 'gemini-2.0-flash' },
]

const FALLBACK_PRICING: ModelPricing = {
  inputPerMillion: 1.0,
  outputPerMillion: 3.0,
  provider: 'unknown',
}

export function getModelPricing(model: string): ModelPricing {
  if (MODEL_PRICING[model]) {
    return MODEL_PRICING[model]
  }

  const alias = MODEL_ALIASES[model]
  if (alias && MODEL_PRICING[alias]) {
    return MODEL_PRICING[alias]
  }

  for (const { pattern, fallbackModel } of MODEL_FAMILY_FALLBACKS) {
    if (pattern.test(model) && MODEL_PRICING[fallbackModel]) {
      return MODEL_PRICING[fallbackModel]
    }
  }

  return FALLBACK_PRICING
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getModelPricing(model)
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion
  return inputCost + outputCost
}

export function estimateEmbeddingCost(model: string, tokenCount: number): number {
  const pricing = getModelPricing(model)
  return (tokenCount / 1_000_000) * pricing.inputPerMillion
}

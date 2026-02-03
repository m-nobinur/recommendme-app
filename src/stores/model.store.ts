'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AIProvider, ModelTier } from '@/lib/ai/providers/types'

export interface ModelConfig {
  id: string
  name: string
  description: string
}

export interface ProviderConfig {
  id: AIProvider
  name: string
  description: string
  docsUrl: string
  requiresApiKey: boolean
  apiKeyEnvVar?: string
  models: Record<ModelTier, ModelConfig>
}

export const BRAIN_TIERS: Record<
  ModelTier,
  { label: string; description: string; icon: 'sparkles' | 'zap' | 'bolt' }
> = {
  smartest: {
    label: 'Smartest',
    description: 'Most capable for complex reasoning',
    icon: 'sparkles',
  },
  smart: {
    label: 'Smart',
    description: 'Balanced performance and speed',
    icon: 'zap',
  },
  regular: {
    label: 'Regular',
    description: 'Quick responses for simple tasks',
    icon: 'bolt',
  },
}

export const PROVIDERS: Record<AIProvider, ProviderConfig> = {
  gateway: {
    id: 'gateway',
    name: 'AI Gateway',
    description: 'Managed AI infrastructure with caching & analytics',
    docsUrl: 'https://vercel.com/docs/ai',
    requiresApiKey: false,
    models: {
      smartest: {
        id: 'claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet',
        description: "Anthropic's best model",
      },
      smart: {
        id: 'gpt-4o',
        name: 'GPT-4o',
        description: "OpenAI's flagship",
      },
      regular: {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        description: 'Faster, cost-effective',
      },
    },
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    description: "Direct access to Google's Gemini models",
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models/gemini',
    requiresApiKey: true,
    apiKeyEnvVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    models: {
      smartest: {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash',
        description: 'Balanced speed & frontier intelligence',
      },
      smart: {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: 'Best price-performance',
      },
      regular: {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash-Lite',
        description: 'Fastest & cost-efficient',
      },
    },
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'Direct access to OpenAI models',
    docsUrl: 'https://platform.openai.com/docs',
    requiresApiKey: true,
    apiKeyEnvVar: 'OPENAI_API_KEY',
    models: {
      smartest: {
        id: 'gpt-4o',
        name: 'GPT-4o',
        description: "OpenAI's flagship model",
      },
      smart: {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        description: 'Fast & capable',
      },
      regular: {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        description: 'Quick & cost-effective',
      },
    },
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access multiple AI providers through a single API',
    docsUrl: 'https://openrouter.ai/docs',
    requiresApiKey: true,
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    models: {
      smartest: {
        id: 'anthropic/claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        description: 'Best for complex reasoning',
      },
      smart: {
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        description: 'Fast & capable',
      },
      regular: {
        id: 'openai/gpt-4o-mini',
        name: 'GPT-4o Mini',
        description: 'Quick & cost-effective',
      },
    },
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-fast inference with Groq hardware',
    docsUrl: 'https://groq.com/docs',
    requiresApiKey: true,
    apiKeyEnvVar: 'GROQ_API_KEY',
    models: {
      smartest: {
        id: 'llama-3.3-70b-versatile',
        name: 'Llama 3.3 70B',
        description: 'Most capable Llama model',
      },
      smart: {
        id: 'llama-3.1-8b-instant',
        name: 'Llama 3.1 8B',
        description: 'Balanced performance',
      },
      regular: {
        id: 'llama-3.1-8b-instant',
        name: 'Llama 3.1 8B',
        description: 'Fast inference',
      },
    },
  },
}

const DEFAULT_PROVIDER: AIProvider = 'gemini'
const DEFAULT_BRAIN_TIER: ModelTier = 'smart'

interface ModelState {
  provider: AIProvider
  brainTier: ModelTier

  setProvider: (provider: AIProvider) => void
  setBrainTier: (tier: ModelTier) => void

  getCurrentProvider: () => ProviderConfig
  getCurrentModel: () => ModelConfig
  getCurrentModelId: () => string
}

export const useModelStore = create<ModelState>()(
  persist(
    (set, get) => ({
      provider: DEFAULT_PROVIDER,
      brainTier: DEFAULT_BRAIN_TIER,

      setProvider: (provider) => set({ provider }),
      setBrainTier: (tier) => set({ brainTier: tier }),

      getCurrentProvider: () => PROVIDERS[get().provider],
      getCurrentModel: () => PROVIDERS[get().provider].models[get().brainTier],
      getCurrentModelId: () => PROVIDERS[get().provider].models[get().brainTier].id,
    }),
    {
      name: 'reme-model-config',
    }
  )
)

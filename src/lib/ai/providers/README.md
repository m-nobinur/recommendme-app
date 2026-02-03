# AI Providers

Production-ready provider system for accessing multiple AI models through a unified interface.

## Overview

Access 5 AI providers with one consistent API:

| Provider | Description | Best For |
|----------|-------------|----------|
| **Gemini** | Google's latest models | Default, best price/performance |
| **OpenAI** | GPT-5, reasoning models | Advanced reasoning tasks |
| **OpenRouter** | 100+ models, one API key | Model flexibility |
| **Groq** | LPU-powered inference | Ultra-fast responses |
| **AI Gateway** | Multi-provider with failover | Production reliability |

## Quick Start

### 1. Set Up Environment

Add at least one API key to `.env.local`:

```env
# Recommended for getting started
GOOGLE_GENERATIVE_AI_API_KEY=your-key-here

# Optional providers
OPENAI_API_KEY=your-key-here
OPENROUTER_API_KEY=your-key-here
GROQ_API_KEY=your-key-here
```

### 2. Use in Your Code

```typescript
import { createAIProvider } from '@/lib/ai/providers'
import { generateText } from 'ai'

// Simple - uses Gemini by default
const model = createAIProvider()
const { text } = await generateText({ 
  model, 
  prompt: 'Explain quantum computing' 
})

// With specific provider and tier
const model = createAIProvider('openai', 'smartest')
```

## Model Tiers

Choose the right tier for your use case:

| Tier | Cost | Speed | Intelligence | Use Case |
|------|------|-------|--------------|----------|
| `smartest` | $$$ | Slower | Best | Research, complex reasoning |
| `smart` | $$ | Fast | Great | Production apps (default) |
| `regular` | $ | Fastest | Good | High-volume, simple tasks |

## Common Patterns

### Check Provider Availability

```typescript
import { getConfiguredProviders } from '@/lib/ai/providers'

const available = getConfiguredProviders()
console.log('Available:', available) // ['gemini', 'openai']

// Use first available
const provider = available[0] || 'gemini'
const model = createAIProvider(provider, 'smart')
```

### Error Handling with Fallback

```typescript
import { createAIProvider } from '@/lib/ai/providers'

try {
  const model = createAIProvider('openai', 'smart')
} catch (error) {
  console.error('OpenAI not configured, using Gemini')
  const model = createAIProvider('gemini', 'smart')
}
```

### Direct Provider Access

```typescript
import { providers } from '@/lib/ai/providers'

// Use specific models directly
const gemini = providers.gemini('gemini-2.5-flash')
const gpt = providers.openai('gpt-5-mini')
const llama = providers.groq('llama-3.1-8b-instant')
```

## Provider-Specific Features

### Google Gemini

```typescript
import { google } from '@ai-sdk/google'

// Google Search integration
const result = await generateText({
  model: providers.gemini('gemini-2.5-flash'),
  prompt: 'Latest AI news this week?',
  tools: { google_search: google.tools.googleSearch({}) }
})

// Code execution
const result = await generateText({
  model: providers.gemini('gemini-2.5-pro'),
  prompt: 'Calculate the 20th fibonacci number',
  tools: { code_execution: google.tools.codeExecution({}) }
})
```

### OpenAI

```typescript
// Reasoning models (o1, o3, o4)
const result = await generateText({
  model: providers.openai('gpt-5'),
  prompt: 'Complex problem...',
  providerOptions: {
    openai: {
      reasoningEffort: 'high',
      reasoningSummary: 'detailed'
    }
  }
})
```

### Groq

```typescript
// Ultra-fast inference
const result = await generateText({
  model: providers.groq('llama-3.1-8b-instant'),
  prompt: 'Quick response needed',
  providerOptions: {
    groq: { serviceTier: 'flex' } // 10x rate limits
  }
})

// Reasoning models
const result = await generateText({
  model: providers.groq('qwen/qwen3-32b'),
  prompt: 'Reasoning task',
  providerOptions: {
    groq: { 
      reasoningFormat: 'parsed',
      reasoningEffort: 'default'
    }
  }
})
```

### OpenRouter

```typescript
// Access 100+ models with fallback
const result = await generateText({
  model: providers.openrouter('anthropic/claude-3.5-sonnet'),
  prompt: 'Generate code',
  providerOptions: {
    openrouter: {
      models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o'],
      route: 'fallback'
    }
  }
})
```

## Architecture

```
src/lib/ai/providers/
├── index.ts       # Main API & factory
├── types.ts       # TypeScript types
├── config.ts      # Provider configs & models
├── factories.ts   # Provider implementations
└── env.ts         # Environment validation
```

**Design Principles:**
- Single Responsibility - Each file has one purpose
- Open/Closed - Easy to extend, no modifications needed
- Type Safety - Full TypeScript support
- DRY - Zero code duplication

## Troubleshooting

**Missing API Key**
```
Error: Missing API key for Google Gemini
```
→ Add `GOOGLE_GENERATIVE_AI_API_KEY` to `.env.local`

**Invalid Provider**
```
Error: Invalid provider: xyz
```
→ Use: `gateway`, `gemini`, `openai`, `openrouter`, or `groq`

**No Providers Configured**
```
Error: No AI providers configured
```
→ Set at least one API key in `.env.local`

## Advanced Topics

### Adding a New Provider

1. Add provider to `types.ts` → `AIProvider` type
2. Add config to `config.ts` → `PROVIDER_CONFIGS`
3. Create factory in `factories.ts`
4. Register in `index.ts` → `PROVIDER_FACTORIES`

### Provider Configuration Details

```typescript
import { PROVIDER_CONFIGS, TIER_INFO } from '@/lib/ai/providers'

// Get provider info
const info = PROVIDER_CONFIGS.gemini
console.log(info.name, info.models)

// Get tier info
const tier = TIER_INFO.smart
console.log(tier.costLevel, tier.speedLevel)
```

### Production Best Practices

```typescript
// ✅ Use AI Gateway for automatic failover
const model = createAIProvider('gateway', 'smart')

// ✅ Check availability before use
if (hasApiKey('openai')) {
  const model = createAIProvider('openai', 'smart')
}

// ✅ Optimize costs by tier
const simple = createAIProvider('groq', 'regular')    // Cheap & fast
const balanced = createAIProvider('gemini', 'smart')   // Best value
const complex = createAIProvider('openai', 'smartest') // Best quality
```

## Resources

- [AI SDK Documentation](https://sdk.vercel.ai/docs)
- [Google Gemini](https://ai.google.dev/gemini-api/docs)
- [OpenAI](https://platform.openai.com/docs)
- [OpenRouter](https://openrouter.ai/docs)
- [Groq](https://console.groq.com/docs)
- [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)

---

For migration guide, see [MIGRATION.md](./MIGRATION.md)  
For detailed changelog, see [CHANGELOG.md](./CHANGELOG.md)

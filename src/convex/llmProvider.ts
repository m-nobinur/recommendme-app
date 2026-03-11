import { ConvexError } from 'convex/values'

const MAX_LLM_RETRIES = 2
const LLM_REQUEST_TIMEOUT_MS = Number(process.env.AGENT_LLM_TIMEOUT_MS ?? 20000)

export const LLM_PROVIDERS = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    envVar: 'OPENROUTER_API_KEY',
    model: 'openai/gpt-4o-mini',
    name: 'OpenRouter',
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    envVar: 'OPENAI_API_KEY',
    model: 'gpt-4o-mini',
    name: 'OpenAI',
  },
} as const

export type LLMProviderKey = keyof typeof LLM_PROVIDERS

export interface ResolvedLLMProvider {
  url: string
  apiKey: string
  model: string
  providerId: 'openrouter' | 'openai'
  name: string
}

export interface LLMUsageInfo {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  model: string
  provider: string
  latencyMs: number
  exactCostUsd?: number
}

export interface LLMCallResult {
  content: unknown
  usage: LLMUsageInfo
}

/**
 * Resolve the first available LLM provider from environment variables.
 *
 * Default (no args or throwOnMissing: true): throws ConvexError if nothing configured.
 * throwOnMissing: false: returns null for optional paths (e.g. archival).
 */
export function resolveLLMProvider(): ResolvedLLMProvider
export function resolveLLMProvider(options: { throwOnMissing: false }): ResolvedLLMProvider | null
export function resolveLLMProvider(options: { throwOnMissing: true }): ResolvedLLMProvider
export function resolveLLMProvider(options?: {
  throwOnMissing?: boolean
}): ResolvedLLMProvider | null {
  const shouldThrow = options?.throwOnMissing !== false
  const order: LLMProviderKey[] = ['openrouter', 'openai']

  for (const key of order) {
    const provider = LLM_PROVIDERS[key]
    const apiKey = process.env[provider.envVar]
    if (apiKey?.trim()) {
      return {
        url: provider.url,
        apiKey,
        model: provider.model,
        providerId: key,
        name: provider.name,
      }
    }
  }

  if (shouldThrow) {
    throw new ConvexError({
      code: 'CONFIGURATION_ERROR',
      message: 'No LLM provider configured. Set OPENROUTER_API_KEY or OPENAI_API_KEY.',
    })
  }

  return null
}

function extractUsageFromResponse(
  data: any,
  provider: ResolvedLLMProvider,
  latencyMs: number
): LLMUsageInfo {
  const usage = data?.usage
  const inputTokens = usage?.prompt_tokens ?? 0
  const outputTokens = usage?.completion_tokens ?? 0

  let exactCostUsd: number | undefined
  const rawCost = data?.usage?.total_cost ?? data?.total_cost
  if (typeof rawCost === 'number' && rawCost > 0) {
    exactCostUsd = rawCost
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: usage?.total_tokens ?? inputTokens + outputTokens,
    model: provider.model,
    provider: provider.providerId,
    latencyMs,
    exactCostUsd,
  }
}

/**
 * Call an LLM provider with JSON response format and retry logic.
 * Returns both the parsed content and usage metadata.
 */
export async function callLLMWithUsage(
  provider: ResolvedLLMProvider,
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0,
  maxTokens: number = 2500
): Promise<LLMCallResult> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    let timeout: ReturnType<typeof setTimeout> | null = null
    const attemptStart = Date.now()
    try {
      const controller = new AbortController()
      timeout = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS)
      const response = await fetch(provider.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        const error = new Error(
          `${provider.name} API error (${response.status}): ${errorBody.slice(0, 200)}`
        )
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw error
        }
        lastError = error
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
        continue
      }

      const data = await response.json()
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new Error('Empty response from LLM')

      const latencyMs = Date.now() - attemptStart
      return {
        content: JSON.parse(content),
        usage: extractUsageFromResponse(data, provider, latencyMs),
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new Error(
          `${provider.name} request timed out after ${LLM_REQUEST_TIMEOUT_MS}ms`
        )
      } else {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
      if (attempt < MAX_LLM_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
      }
    } finally {
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  }

  throw lastError ?? new Error('LLM call failed after retries')
}

/**
 * Call an LLM provider with JSON response format and retry logic.
 * Backward-compatible wrapper that discards usage info.
 */
export async function callLLM(
  provider: ResolvedLLMProvider,
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0,
  maxTokens: number = 2500
): Promise<unknown> {
  const result = await callLLMWithUsage(provider, systemPrompt, userPrompt, temperature, maxTokens)
  return result.content
}

import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation } from './_generated/server'

/**
 * Embedding Service (Convex Actions)
 *
 * Generates embeddings via OpenAI-compatible APIs (1536 dimensions).
 * All functions are internal — only callable from other Convex functions.
 *
 * Provider Priority:
 *   1. OpenRouter (default) — OPENROUTER_API_KEY
 *   2. OpenAI (fallback)   — OPENAI_API_KEY
 *
 * Both providers use the same OpenAI-compatible /v1/embeddings endpoint,
 * so the code is identical except for the base URL and API key.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  EMBEDDING PIPELINE                                                 │
 * │  ══════════════════                                                 │
 * │                                                                     │
 * │  Memory Created/Updated                                             │
 * │    ↓ ctx.scheduler.runAfter(0, ...)                                 │
 * │  generateAndStore (internalAction)                                  │
 * │    ↓ resolveProvider() → pick OpenRouter or OpenAI                  │
 * │    ↓ callEmbeddingsAPI() with retry + backoff                       │
 * │    ↓ returns float64[1536]                                          │
 * │  patchEmbedding (internalMutation)                                  │
 * │    ↓ patches document with embedding vector                         │
 * │  Memory now searchable via vector index                             │
 * │                                                                     │
 * │  Error Handling:                                                    │
 * │  - Retry with exponential backoff (max 3 retries)                   │
 * │  - Memory remains usable even if embedding fails                    │
 * │  - Failures logged with token/cost info for monitoring              │
 * └─────────────────────────────────────────────────────────────────────┘
 */

// ============================================
// Constants
// ============================================

const EMBEDDING_MODEL = 'openai/text-embedding-3-small'
const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536
const MAX_RETRIES = 3
const MAX_BATCH_SIZE = 100

/**
 * Provider configurations for embedding generation.
 * OpenRouter is the default; OpenAI is the fallback.
 */
const PROVIDERS = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/embeddings',
    envVar: 'OPENROUTER_API_KEY',
    model: EMBEDDING_MODEL,
    name: 'OpenRouter',
  },
  openai: {
    url: 'https://api.openai.com/v1/embeddings',
    envVar: 'OPENAI_API_KEY',
    model: OPENAI_EMBEDDING_MODEL,
    name: 'OpenAI',
  },
} as const

type ProviderKey = keyof typeof PROVIDERS
type ResolvedProvider = { url: string; apiKey: string; model: string; name: string }

/**
 * Valid memory table names that support embeddings.
 */
const memoryTableNames = v.union(
  v.literal('platformMemories'),
  v.literal('nicheMemories'),
  v.literal('businessMemories'),
  v.literal('agentMemories')
)

// ============================================
// Provider Resolution
// ============================================

/**
 * Resolve which embedding provider to use.
 * Priority: OpenRouter → OpenAI.
 * Throws if neither is configured.
 */
function resolveProvider(): ResolvedProvider {
  const order: ProviderKey[] = ['openrouter', 'openai']

  for (const key of order) {
    const provider = PROVIDERS[key]
    const apiKey = process.env[provider.envVar]
    if (apiKey && apiKey.trim().length > 0) {
      return { url: provider.url, apiKey, model: provider.model, name: provider.name }
    }
  }

  throw new ConvexError({
    code: 'CONFIGURATION_ERROR',
    message:
      'No embedding provider configured. Set OPENROUTER_API_KEY (preferred) or OPENAI_API_KEY.',
  })
}

// ============================================
// Core API Call (shared by all public functions)
// ============================================

/**
 * Call an OpenAI-compatible embeddings API with retry logic.
 * Uses exponential backoff: 1s, 2s, 4s.
 *
 * This is a pure function (no Convex ctx) so it can be called
 * directly from any action handler — avoids the action-calls-action
 * overhead of ctx.runAction().
 */
async function callEmbeddingsAPI(
  provider: ResolvedProvider,
  input: string | string[]
): Promise<{ embeddings: number[][]; totalTokens: number }> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(provider.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          input,
          dimensions: EMBEDDING_DIMENSIONS,
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
        const delay = 1000 * 2 ** attempt
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      const data = await response.json()

      // Sort by index to guarantee input order
      const embeddings: number[][] = data.data
        .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
        .map((item: { embedding: number[] }) => item.embedding)

      const totalTokens: number = data.usage?.total_tokens ?? 0

      return { embeddings, totalTokens }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('API error') &&
        error.message.includes('(4')
      ) {
        throw error
      }

      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < MAX_RETRIES - 1) {
        const delay = 1000 * 2 ** attempt
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError ?? new Error('Embedding generation failed after retries')
}

/**
 * Generate embedding(s) from text using the resolved provider.
 */
async function generateEmbeddingVector(text: string): Promise<number[]> {
  const provider = resolveProvider()
  const trimmedText = text.trim()

  if (trimmedText.length === 0) {
    throw new ConvexError({
      code: 'INVALID_INPUT',
      message: 'Cannot generate embedding for empty text',
    })
  }

  const { embeddings, totalTokens } = await callEmbeddingsAPI(provider, trimmedText)

  console.log(`[Embedding] Generated via ${provider.name}:`, {
    textLength: trimmedText.length,
    dimensions: embeddings[0].length,
    tokens: totalTokens,
  })

  return embeddings[0]
}

// ============================================
// Generate Single Embedding (internalAction)
// ============================================

/**
 * Generate a single embedding vector from text.
 * Returns a 1536-dimension float64 array.
 *
 * Provider: OpenRouter (default) → OpenAI (fallback).
 */
export const generateEmbedding = internalAction({
  args: {
    text: v.string(),
  },
  handler: async (_, args): Promise<number[]> => {
    return generateEmbeddingVector(args.text)
  },
})

// ============================================
// Generate Batch Embeddings (internalAction)
// ============================================

/**
 * Generate embeddings for multiple texts in a single API call.
 * Supports up to 100 texts per batch.
 * Returns embeddings in the same order as input texts.
 */
export const generateEmbeddings = internalAction({
  args: {
    texts: v.array(v.string()),
  },
  handler: async (_, args): Promise<number[][]> => {
    if (args.texts.length === 0) {
      return []
    }

    if (args.texts.length > MAX_BATCH_SIZE) {
      throw new ConvexError({
        code: 'INVALID_INPUT',
        message: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} texts`,
      })
    }

    const trimmedTexts = args.texts.map((t) => t.trim()).filter((t) => t.length > 0)

    if (trimmedTexts.length === 0) {
      return []
    }

    const provider = resolveProvider()
    const { embeddings, totalTokens } = await callEmbeddingsAPI(provider, trimmedTexts)

    console.log(`[Embedding] Generated batch via ${provider.name}:`, {
      count: trimmedTexts.length,
      dimensions: embeddings[0]?.length ?? 0,
      tokens: totalTokens,
    })

    return embeddings
  },
})

// ============================================
// Generate and Store Embedding (internalAction)
// ============================================

/**
 * Generate an embedding for a memory document and store it.
 * Scheduled by memory CRUD mutations via ctx.scheduler.runAfter(0, ...).
 *
 * This is the primary entry point for auto-embedding on memory creation/update.
 *
 * Failures are logged but do not affect the memory document — it remains
 * usable without an embedding, just not vector-searchable.
 */
export const generateAndStore = internalAction({
  args: {
    tableName: memoryTableNames,
    documentId: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    try {
      const embedding = await generateEmbeddingVector(args.content)

      await ctx.runMutation(internal.embedding.patchEmbedding, {
        tableName: args.tableName,
        documentId: args.documentId,
        embedding,
      })

      console.log('[Embedding] Stored embedding:', {
        table: args.tableName,
        documentId: args.documentId,
        contentLength: args.content.length,
      })
    } catch (error) {
      console.error('[Embedding] Failed to generate/store embedding:', {
        table: args.tableName,
        documentId: args.documentId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },
})

// ============================================
// Patch Embedding on Document (internalMutation)
// ============================================

/**
 * Patch the embedding field on a memory document.
 * Internal mutation — called by generateAndStore after embedding generation.
 *
 * Idempotent: checks if document exists before patching.
 * Supports all 4 memory table types via a generic handler.
 *
 * NOTE: Convex requires typed Id<TableName> for db.get/patch, but since
 * we receive tableName as a runtime union string and documentId as a string,
 * we must cast. The switch ensures we only operate on valid table names.
 */
export const patchEmbedding = internalMutation({
  args: {
    tableName: memoryTableNames,
    documentId: v.string(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    if (args.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new ConvexError({
        code: 'INVALID_EMBEDDING',
        message: `Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${args.embedding.length}`,
      })
    }

    const validTables = new Set([
      'platformMemories',
      'nicheMemories',
      'businessMemories',
      'agentMemories',
    ])
    if (!validTables.has(args.tableName)) {
      throw new ConvexError({
        code: 'INVALID_TABLE',
        message: `Unknown memory table: ${args.tableName}`,
      })
    }

    const doc = await ctx.db.get(args.documentId as any)
    if (!doc) {
      console.warn('[Embedding] Document not found, skipping patch:', {
        table: args.tableName,
        documentId: args.documentId,
      })
      return { success: false }
    }

    await ctx.db.patch(args.documentId as any, {
      embedding: args.embedding,
      updatedAt: Date.now(),
    })

    return { success: true }
  },
})

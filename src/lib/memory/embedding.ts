/**
 * Embedding Utility Library
 *
 * Shared constants and functions for use in the Next.js application.
 * These are pure utility functions — no API calls or side effects.
 *
 * Note: Actual embedding generation and vector search happen in Convex
 * (see src/convex/embedding.ts and src/convex/vectorSearch.ts).
 * This module provides complementary utilities for the Next.js side.
 *
 * Provider Priority (configured in Convex):
 *   1. OpenRouter (default) — OPENROUTER_API_KEY
 *   2. OpenAI (fallback)   — OPENAI_API_KEY
 */

// ============================================
// Constants
// ============================================

/** Embedding dimensions for text-embedding-3-small */
export const EMBEDDING_DIMENSIONS = 1536

/** Minimum cosine similarity score to consider a result relevant */
export const SIMILARITY_THRESHOLD = 0.5

/** Cosine similarity score above which two memories are considered duplicates */
export const DUPLICATE_THRESHOLD = 0.92

/** OpenRouter embedding model (OpenAI-compatible format) */
export const EMBEDDING_MODEL_OPENROUTER = 'openai/text-embedding-3-small'

/** OpenAI embedding model (direct) */
export const EMBEDDING_MODEL_OPENAI = 'text-embedding-3-small'

// ============================================
// Memory Layer Limits (defaults for search)
// ============================================

/** Default result limits per memory layer during search */
export const LAYER_LIMITS = {
  platform: 5,
  niche: 10,
  business: 20,
  agent: 10,
} as const

// ============================================
// Math Utilities
// ============================================

/**
 * Compute cosine similarity between two embedding vectors.
 *
 * Returns a value between -1 and 1, where:
 * - 1.0 = identical direction (most similar)
 * - 0.0 = orthogonal (unrelated)
 * - -1.0 = opposite direction (least similar)
 *
 * Optimized: single-pass computation of dot product and norms
 * with cached array length (per Vercel React best practices 7.3).
 *
 * @param a - First embedding vector
 * @param b - Second embedding vector
 * @returns Cosine similarity score
 * @throws If vectors have different lengths or are zero-length
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = a.length
  if (len !== b.length) {
    throw new Error(`Vector length mismatch: ${len} vs ${b.length}`)
  }

  if (len === 0) {
    throw new Error('Cannot compute cosine similarity of empty vectors')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < len; i++) {
    const ai = a[i]
    const bi = b[i]
    dotProduct += ai * bi
    normA += ai * ai
    normB += bi * bi
  }

  const magnitude = Math.sqrt(normA * normB)

  if (magnitude === 0) {
    return 0
  }

  return dotProduct / magnitude
}

/**
 * Check if two embeddings are similar enough to be considered duplicates.
 *
 * @param a - First embedding vector
 * @param b - Second embedding vector
 * @param threshold - Similarity threshold (defaults to DUPLICATE_THRESHOLD)
 * @returns true if similarity exceeds the threshold
 */
export function isDuplicate(
  a: number[],
  b: number[],
  threshold: number = DUPLICATE_THRESHOLD
): boolean {
  return cosineSimilarity(a, b) >= threshold
}

/**
 * Check if a similarity score meets the minimum relevance threshold.
 *
 * @param score - Cosine similarity score
 * @param threshold - Minimum threshold (defaults to SIMILARITY_THRESHOLD)
 * @returns true if score meets the threshold
 */
export function isRelevant(score: number, threshold: number = SIMILARITY_THRESHOLD): boolean {
  return score >= threshold
}

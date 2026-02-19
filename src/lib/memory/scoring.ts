/**
 * Scoring and Ranking Engine
 *
 * Computes composite scores for retrieved memories and ranks them.
 * Supports all 4 memory layers with layer-specific weights.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  COMPOSITE SCORING FORMULA                                       │
 * │                                                                  │
 * │  score = W_rel * relevance                                       │
 * │        + W_imp * importance                                      │
 * │        + W_rec * recencyScore                                    │
 * │        + W_freq * frequencyScore                                 │
 * │                                                                  │
 * │  Weights: relevance=0.4, importance=0.25, recency=0.2, freq=0.15 │
 * │                                                                  │
 * │  Layer multipliers: platform=0.5, niche=0.7, business=1.0,       │
 * │                     agent=0.8                                    │
 * │                                                                  │
 * │  Boosts:                                                         │
 * │  - Recency: memories accessed in last 7 days get 1.2x            │
 * │  - Access: min(1.1, 1.0 + accessCount * 0.005)                   │
 * │                                                                  │
 * │  Filters:                                                        │
 * │  - Decay: exclude memories with decayScore < 0.1                 │
 * └──────────────────────────────────────────────────────────────────┘
 */

import type {
  AgentMemory,
  BusinessMemory,
  BusinessMemoryType,
  NicheMemory,
  PlatformMemory,
} from '@/types'
import type { QueryAnalysis } from './queryAnalysis'

// ============================================
// TYPES
// ============================================

export type MemoryLayerName = 'platform' | 'niche' | 'business' | 'agent'

export interface ScoredMemory<T> {
  document: T
  relevanceScore: number
  compositeScore: number
  layer: MemoryLayerName
}

export interface ScoredSearchResults {
  platform: Array<ScoredMemory<PlatformMemory>>
  niche: Array<ScoredMemory<NicheMemory>>
  business: Array<ScoredMemory<BusinessMemory>>
  agent: Array<ScoredMemory<AgentMemory>>
}

export interface RawSearchResults {
  platform: Array<{ document: PlatformMemory; score: number }>
  niche: Array<{ document: NicheMemory; score: number }>
  business: Array<{ document: BusinessMemory; score: number }>
  agent: Array<{ document: AgentMemory; score: number }>
}

// ============================================
// SCORING CONSTANTS (all hoisted to module scope)
// ============================================

/** Composite score weights (must sum to 1.0) */
const WEIGHT_RELEVANCE = 0.4
const WEIGHT_IMPORTANCE = 0.25
const WEIGHT_RECENCY = 0.2
const WEIGHT_FREQUENCY = 0.15

/** Layer priority multipliers */
const LAYER_WEIGHTS: Record<MemoryLayerName, number> = {
  platform: 0.5,
  niche: 0.7,
  business: 1.0,
  agent: 0.8,
}

/** Recency window: 7 days in milliseconds */
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** Recency boost multiplier for recently accessed memories */
const RECENCY_BOOST = 1.2

const MAX_FREQUENCY_BOOST = 1.1
const FREQUENCY_BOOST_RATE = 0.005

/** Minimum decay score to keep a memory */
const DECAY_THRESHOLD = 0.1

/** Intent-type bonus when a memory type matches a query intent */
const INTENT_MATCH_BONUS = 0.1

/** Half-life for exponential decay: 30 days in ms (hoisted, computed once) */
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000

/** Pre-computed decay coefficient: -ln(2) / halfLife */
const DECAY_COEFFICIENT = -Math.LN2 / HALF_LIFE_MS

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Compute recency score from a timestamp.
 * Returns 1.0 for very recent memories, decaying towards 0.0 for old ones.
 * Uses exponential decay with a 30-day half-life.
 * Pre-computed coefficient avoids division per call.
 */
function computeRecencyScore(timestampMs: number, now: number): number {
  const ageMs = now - timestampMs
  if (ageMs <= 0) return 1.0
  return Math.exp(DECAY_COEFFICIENT * ageMs)
}

/**
 * Compute access frequency boost.
 * Capped at MAX_FREQUENCY_BOOST to avoid runaway scores.
 */
function computeFrequencyBoost(accessCount: number): number {
  return Math.min(MAX_FREQUENCY_BOOST, 1.0 + accessCount * FREQUENCY_BOOST_RATE)
}

/**
 * Core composite score calculation.
 * Pure function: takes normalized inputs, returns final score.
 */
function computeCompositeScore(
  relevance: number,
  importance: number,
  recencyTimestamp: number,
  frequencyBoost: number,
  layerWeight: number,
  now: number,
  intentBonus: number
): number {
  const recency = computeRecencyScore(recencyTimestamp, now)

  let score =
    WEIGHT_RELEVANCE * relevance +
    WEIGHT_IMPORTANCE * importance +
    WEIGHT_RECENCY * recency +
    WEIGHT_FREQUENCY * (frequencyBoost - 1.0)

  score *= layerWeight

  if (now - recencyTimestamp < RECENCY_WINDOW_MS) {
    score *= RECENCY_BOOST
  }

  return score + intentBonus
}

// ============================================
// LAYER-SPECIFIC SCORING
// ============================================

/**
 * Score platform memories.
 * Platform memories lack importance/decay/accessCount, so we use
 * confidence as importance proxy and sourceCount as frequency proxy.
 */
function scorePlatformMemories(
  results: Array<{ document: PlatformMemory; score: number }>,
  now: number
): Array<ScoredMemory<PlatformMemory>> {
  const scored: Array<ScoredMemory<PlatformMemory>> = []

  for (const { document, score } of results) {
    if (!document.isActive) continue

    const compositeScore = computeCompositeScore(
      score,
      document.confidence,
      document.updatedAt,
      Math.min(MAX_FREQUENCY_BOOST, 1.0 + document.sourceCount * 0.01),
      LAYER_WEIGHTS.platform,
      now,
      0
    )

    scored.push({ document, relevanceScore: score, compositeScore, layer: 'platform' })
  }

  return scored
}

/**
 * Score niche memories.
 * Niche memories use confidence and contributorCount.
 */
function scoreNicheMemories(
  results: Array<{ document: NicheMemory; score: number }>,
  now: number
): Array<ScoredMemory<NicheMemory>> {
  const scored: Array<ScoredMemory<NicheMemory>> = []

  for (const { document, score } of results) {
    if (!document.isActive) continue

    const compositeScore = computeCompositeScore(
      score,
      document.confidence,
      document.updatedAt,
      Math.min(MAX_FREQUENCY_BOOST, 1.0 + document.contributorCount * 0.01),
      LAYER_WEIGHTS.niche,
      now,
      0
    )

    scored.push({ document, relevanceScore: score, compositeScore, layer: 'niche' })
  }

  return scored
}

/**
 * Score business memories.
 * Business memories have the richest metadata: importance, decayScore,
 * accessCount, lastAccessedAt. Full scoring formula applies.
 */
function scoreBusinessMemories(
  results: Array<{ document: BusinessMemory; score: number }>,
  now: number,
  requiredTypes: Set<BusinessMemoryType>
): Array<ScoredMemory<BusinessMemory>> {
  const scored: Array<ScoredMemory<BusinessMemory>> = []

  for (const { document, score } of results) {
    // Skip decayed/inactive/archived in single check
    if (document.decayScore < DECAY_THRESHOLD || !document.isActive || document.isArchived) continue

    const intentBonus = requiredTypes.has(document.type) ? INTENT_MATCH_BONUS : 0

    const compositeScore = computeCompositeScore(
      score,
      document.importance,
      document.lastAccessedAt,
      computeFrequencyBoost(document.accessCount),
      LAYER_WEIGHTS.business,
      now,
      intentBonus
    )

    scored.push({ document, relevanceScore: score, compositeScore, layer: 'business' })
  }

  return scored
}

/**
 * Score agent memories.
 * Agent memories have decayScore, useCount, successRate.
 */
function scoreAgentMemories(
  results: Array<{ document: AgentMemory; score: number }>,
  now: number
): Array<ScoredMemory<AgentMemory>> {
  const scored: Array<ScoredMemory<AgentMemory>> = []

  for (const { document, score } of results) {
    if (document.decayScore < DECAY_THRESHOLD || !document.isActive) continue

    const compositeScore = computeCompositeScore(
      score,
      document.confidence * document.successRate,
      document.lastUsedAt,
      computeFrequencyBoost(document.useCount),
      LAYER_WEIGHTS.agent,
      now,
      0
    )

    scored.push({ document, relevanceScore: score, compositeScore, layer: 'agent' })
  }

  return scored
}

// ============================================
// MAIN EXPORT
// ============================================

/**
 * Score and rank memories from all layers.
 *
 * Pure function: takes raw search results + query analysis, returns scored results.
 * Each layer's results are independently scored, then sorted descending by composite score.
 *
 * @param results - Raw search results from Convex vector search
 * @param analysis - Query analysis with intents and entities
 * @returns Scored and sorted results per layer
 */
export function scoreAndRank(
  results: RawSearchResults,
  analysis: QueryAnalysis
): ScoredSearchResults {
  const now = Date.now()

  const requiredTypes = new Set<BusinessMemoryType>(analysis.requiredContextTypes)

  const platform = scorePlatformMemories(results.platform, now)
  const niche = scoreNicheMemories(results.niche, now)
  const business = scoreBusinessMemories(results.business, now, requiredTypes)
  const agent = scoreAgentMemories(results.agent, now)

  platform.sort((a, b) => b.compositeScore - a.compositeScore)
  niche.sort((a, b) => b.compositeScore - a.compositeScore)
  business.sort((a, b) => b.compositeScore - a.compositeScore)
  agent.sort((a, b) => b.compositeScore - a.compositeScore)

  return { platform, niche, business, agent }
}

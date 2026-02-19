/**
 * Memory Retrieval Orchestrator
 *
 * End-to-end pipeline that ties together query analysis, Convex search,
 * scoring, token budgeting, and context formatting.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  RETRIEVAL PIPELINE                                              │
 * │                                                                  │
 * │  1. analyzeQueryAsync(message)    — regex first, AI fallback    │
 * │  2. Convex retrieveContext()      — single round-trip            │
 * │  3. scoreAndRank(results, analysis) — sync                      │
 * │  4. allocateTokenBudget(scored)     — sync                      │
 * │  5. formatContext(selected)         — sync                      │
 * │  6. Return RetrievalResult          — with metadata             │
 * │                                                                  │
 * │  Total async hops: 1-2 (Convex + optional AI intent)            │
 * │  AI intent runs in parallel with Convex search when possible.   │
 * └──────────────────────────────────────────────────────────────────┘
 */

import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { ConvexHttpClient } from 'convex/browser'
import { formatContext } from './contextFormatter'
import { analyzeQuery, analyzeQueryAsync } from './queryAnalysis'
import type { RawSearchResults } from './scoring'
import { scoreAndRank } from './scoring'
import { allocateTokenBudget } from './tokenBudget'

// ============================================
// TYPES
// ============================================

export interface RetrievalResult {
  context: string
  memoriesUsed: number
  memoryIds: string[]
  tokenCount: number
  latencyMs: number
  layerBreakdown: {
    platform: number
    niche: number
    business: number
    agent: number
  }
}

export interface RetrievalParams {
  query: string
  organizationId: string
  nicheId?: string
  agentType?: string
  convexUrl: string
  skipAIIntent?: boolean
}

// ============================================
// CONSTANTS
// ============================================

const EMPTY_LAYER_BREAKDOWN = { platform: 0, niche: 0, business: 0, agent: 0 } as const

// ============================================
// CONVEX CLIENT
// ============================================

let retrievalClient: ConvexHttpClient | null = null
let retrievalClientUrl = ''

function isValidConvexUrl(url: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Get or create a ConvexHttpClient singleton.
 * URL-aware: if the URL changes, the client is recreated.
 */
function getRetrievalClient(url: string): ConvexHttpClient {
  if (!retrievalClient || retrievalClientUrl !== url) {
    retrievalClient = new ConvexHttpClient(url)
    retrievalClientUrl = url
  }
  return retrievalClient
}

// ============================================
// MAIN EXPORT
// ============================================

/**
 * Retrieve memory context for a user message.
 *
 * This is the primary entry point called from the chat API route.
 * It orchestrates the full retrieval pipeline:
 *   1. Quick regex analysis (sync) to decide search params immediately
 *   2. Start Convex search AND AI intent analysis in parallel
 *   3. Await both — use AI intents for scoring if available
 *   4. Scoring, budgeting, formatting (sync)
 *
 * Parallel execution strategy:
 *   - Regex analysis is instant → we use it to kick off Convex search immediately
 *   - If regex returned 'general', AI analysis runs in parallel with Convex search
 *   - When both complete, AI intents replace regex intents for better scoring
 *   - Net effect: AI adds ~0ms extra latency (hidden behind Convex search time)
 *
 * @param params - Retrieval parameters including query, org ID, and Convex URL
 * @returns RetrievalResult with formatted context and metadata
 */
export async function retrieveMemoryContext(params: RetrievalParams): Promise<RetrievalResult> {
  const startTime = performance.now()

  if (!params.query || params.query.trim().length === 0) {
    return {
      context: '',
      memoriesUsed: 0,
      memoryIds: [],
      tokenCount: 0,
      latencyMs: 0,
      layerBreakdown: EMPTY_LAYER_BREAKDOWN,
    }
  }

  if (!isValidConvexUrl(params.convexUrl)) {
    console.warn('[Reme:Memory] Skipping retrieval due to invalid Convex URL')
    return {
      context: '',
      memoriesUsed: 0,
      memoryIds: [],
      tokenCount: 0,
      latencyMs: Math.round(performance.now() - startTime),
      layerBreakdown: EMPTY_LAYER_BREAKDOWN,
    }
  }

  const regexAnalysis = analyzeQuery(params.query)

  const needsAI =
    !params.skipAIIntent &&
    regexAnalysis.intents.length === 1 &&
    regexAnalysis.intents[0] === 'general'

  const aiAnalysisPromise = needsAI ? analyzeQueryAsync(params.query) : null

  const firstSubject = regexAnalysis.subjectHints[0]

  let rawResults: RawSearchResults

  try {
    const convex = getRetrievalClient(params.convexUrl)
    rawResults = await convex.action(api.memoryRetrieval.retrieveContext, {
      query: params.query,
      organizationId: params.organizationId as Id<'organizations'>,
      nicheId: params.nicheId,
      agentType: params.agentType ?? 'chat',
      keywordSubjectType: firstSubject?.subjectType,
    })
  } catch (error) {
    console.error('[Reme:Memory] Retrieval failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      organizationId: params.organizationId,
    })

    return {
      context: '',
      memoriesUsed: 0,
      memoryIds: [],
      tokenCount: 0,
      latencyMs: Math.round(performance.now() - startTime),
      layerBreakdown: EMPTY_LAYER_BREAKDOWN,
    }
  }

  const analysis = aiAnalysisPromise ? await aiAnalysisPromise : regexAnalysis

  const scored = scoreAndRank(rawResults, analysis)

  const selected = allocateTokenBudget(scored)

  const formatted = formatContext({
    platform: selected.platform,
    niche: selected.niche,
    business: selected.business,
    agent: selected.agent,
  })

  const latencyMs = Math.round(performance.now() - startTime)

  return {
    context: formatted.text,
    memoriesUsed: formatted.memoriesUsed,
    memoryIds: formatted.memoryIds,
    tokenCount: formatted.tokenCount,
    latencyMs,
    layerBreakdown: {
      platform: selected.platform.length,
      niche: selected.niche.length,
      business: selected.business.length,
      agent: selected.agent.length,
    },
  }
}

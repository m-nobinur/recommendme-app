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
import { getPerformanceConfig } from '@/lib/ai/config'
import { formatContext } from './contextFormatter'
import {
  analyzeQuery,
  analyzeQueryAsync,
  getRequiredLayers,
  isMemoryCommand,
} from './queryAnalysis'
import type { RawSearchResults } from './scoring'
import { scoreAndRank } from './scoring'
import { allocateTokenBudget } from './tokenBudget'

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
  authToken?: string
  nicheId?: string
  agentType?: string
  convexUrl: string
  skipAIIntent?: boolean
  traceId?: string
}

const EMPTY_LAYER_BREAKDOWN = { platform: 0, niche: 0, business: 0, agent: 0 } as const

let retrievalClient: ConvexHttpClient | null = null
let retrievalClientUrl = ''
const MAX_RETRIEVAL_CACHE_ENTRIES = 1000

interface CachedRetrievalEntry {
  result: RetrievalResult
  expiresAt: number
}

const retrievalCache = new Map<string, CachedRetrievalEntry>()

function buildRetrievalCacheKey(params: RetrievalParams): string {
  return [
    params.organizationId,
    params.authToken ?? '',
    params.nicheId ?? '',
    params.agentType ?? 'chat',
    params.skipAIIntent ? '1' : '0',
    params.query.trim().toLowerCase(),
  ].join('|')
}

function getCachedRetrievalResult(cacheKey: string): RetrievalResult | null {
  const cached = retrievalCache.get(cacheKey)
  if (!cached) return null

  if (cached.expiresAt <= Date.now()) {
    retrievalCache.delete(cacheKey)
    return null
  }

  return cached.result
}

function setCachedRetrievalResult(cacheKey: string, result: RetrievalResult, ttlMs: number): void {
  retrievalCache.set(cacheKey, { result, expiresAt: Date.now() + ttlMs })

  if (retrievalCache.size > MAX_RETRIEVAL_CACHE_ENTRIES) {
    const firstKey = retrievalCache.keys().next().value
    if (firstKey) {
      retrievalCache.delete(firstKey)
    }
  }
}

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
  const stageLatencies = {
    analysisMs: 0,
    searchMs: 0,
    scoringMs: 0,
    budgetMs: 0,
    formatMs: 0,
  }
  const performanceConfig = getPerformanceConfig()
  const cacheEnabled = performanceConfig.enableCaching
  const retrievalCacheTtlMs = performanceConfig.memoryRetrievalCacheTTL * 1000

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
    console.warn('[Reme:Memory] Skipping retrieval due to invalid Convex URL', {
      organizationId: params.organizationId,
      traceId: params.traceId,
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

  const cacheKey = buildRetrievalCacheKey(params)
  if (cacheEnabled) {
    const cached = getCachedRetrievalResult(cacheKey)
    if (cached) {
      return cached
    }
  }

  const analysisStart = performance.now()
  const regexAnalysis = analyzeQuery(params.query)
  stageLatencies.analysisMs = Math.round(performance.now() - analysisStart)

  if (isMemoryCommand(regexAnalysis)) {
    return {
      context: '',
      memoriesUsed: 0,
      memoryIds: [],
      tokenCount: 0,
      latencyMs: Math.round(performance.now() - startTime),
      layerBreakdown: EMPTY_LAYER_BREAKDOWN,
    }
  }

  const requiredLayers = getRequiredLayers(regexAnalysis.intents)

  const needsAI =
    !params.skipAIIntent &&
    regexAnalysis.intents.length === 1 &&
    regexAnalysis.intents[0] === 'general'

  const aiAnalysisPromise = needsAI ? analyzeQueryAsync(params.query) : null

  const firstSubject = regexAnalysis.subjectHints[0]
  const firstContextType = regexAnalysis.requiredContextTypes[0]

  const subjectName = firstSubject?.subjectId ?? firstSubject?.name
  let searchQuery = params.query
  if (subjectName && params.query.trim().split(/\s+/).length <= 8) {
    searchQuery = `Information about a person named ${subjectName}: ${params.query}`
  }

  let rawResults!: RawSearchResults
  const useSelectiveSearch = requiredLayers.length < 4

  const searchStart = performance.now()
  const MAX_RETRIEVAL_RETRIES = 1
  const RETRY_DELAY_MS = 500

  for (let attempt = 0; attempt <= MAX_RETRIEVAL_RETRIES; attempt++) {
    try {
      const convex = getRetrievalClient(params.convexUrl)

      if (useSelectiveSearch) {
        rawResults = await convex.action(api.memoryRetrieval.retrieveSelectedContext, {
          query: searchQuery,
          organizationId: params.organizationId as Id<'organizations'>,
          authToken: params.authToken,
          layers: requiredLayers,
          nicheId: params.nicheId,
          agentType: params.agentType ?? 'chat',
          keywordType: firstContextType,
          keywordSubjectType: firstSubject?.subjectType,
          keywordSubjectId: subjectName,
          traceId: params.traceId,
        })
      } else {
        rawResults = await convex.action(api.memoryRetrieval.retrieveContext, {
          query: searchQuery,
          organizationId: params.organizationId as Id<'organizations'>,
          authToken: params.authToken,
          nicheId: params.nicheId,
          agentType: params.agentType ?? 'chat',
          keywordType: firstContextType,
          keywordSubjectType: firstSubject?.subjectType,
          keywordSubjectId: subjectName,
          traceId: params.traceId,
        })
      }
      stageLatencies.searchMs = Math.round(performance.now() - searchStart)
      break
    } catch (error) {
      const isRetryable = attempt < MAX_RETRIEVAL_RETRIES
      if (isRetryable) {
        console.warn('[Reme:Memory] Retrieval attempt failed, retrying:', {
          attempt,
          error: error instanceof Error ? error.message : 'Unknown error',
          organizationId: params.organizationId,
          traceId: params.traceId,
        })
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * 2 ** attempt))
        continue
      }

      console.error('[Reme:Memory] Retrieval failed after retries:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        organizationId: params.organizationId,
        traceId: params.traceId,
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
  }

  const analysis = aiAnalysisPromise ? await aiAnalysisPromise : regexAnalysis

  const scoringStart = performance.now()
  const scored = scoreAndRank(rawResults, analysis)
  stageLatencies.scoringMs = Math.round(performance.now() - scoringStart)

  const budgetStart = performance.now()
  const selected = allocateTokenBudget(scored)
  stageLatencies.budgetMs = Math.round(performance.now() - budgetStart)

  const formatStart = performance.now()
  const formatted = formatContext({
    platform: selected.platform,
    niche: selected.niche,
    business: selected.business,
    agent: selected.agent,
  })
  stageLatencies.formatMs = Math.round(performance.now() - formatStart)

  const latencyMs = Math.round(performance.now() - startTime)

  const result = {
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

  if (cacheEnabled) {
    setCachedRetrievalResult(cacheKey, result, retrievalCacheTtlMs)
  }

  if (process.env.DEBUG_MEMORY === 'true') {
    console.log('[Reme:MemoryTrace] Retrieval stages', {
      traceId: params.traceId,
      organizationId: params.organizationId,
      ...stageLatencies,
      totalMs: latencyMs,
    })
  }

  return result
}

import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { action } from './_generated/server'
import { isEmbeddingConfigured } from './embedding'
import { assertMemoryApiToken } from './security'

/**
 * Memory Retrieval Actions
 *
 * Two public actions:
 *
 * 1. retrieveContext — full 4-layer retrieval for system prompt injection
 *    (parallel vector + hybrid search, access tracking, scoring/budgeting)
 *
 * 2. searchMemories — lightweight business-layer search for tool use
 *    (single vector search, returns structured results for display)
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  RETRIEVAL FLOW (retrieveContext)                                │
 * │                                                                  │
 * │  Next.js API Route                                               │
 * │    ↓ ConvexHttpClient.action(retrieveContext, args)              │
 * │  retrieveContext (this action)                                   │
 * │    ├ ctx.runAction(searchAllLayers, ...)        ← vector path    │
 * │    └ ctx.runAction(hybridSearchBusinessMemories) ← RRF path      │
 * │  Use hybrid results for business when keyword hints present      │
 * │    ↓ ctx.scheduler.runAfter(0, recordAccess/recordUse, ...)      │
 * │  Return merged results to Next.js                                │
 * ├──────────────────────────────────────────────────────────────────┤
 * │  SEARCH FLOW (searchMemories)                                    │
 * │                                                                  │
 * │  Memory Tool (rememberFact, forgetMemory, searchMemories, etc.)  │
 * │    ↓ ConvexHttpClient.action(searchMemories, args)               │
 * │  searchMemories (this action)                                    │
 * │    ↓ generateEmbedding → searchBusinessMemories (single layer)   │
 * │  Return simplified results (id, content, type, confidence, etc.) │
 * └──────────────────────────────────────────────────────────────────┘
 */

const businessMemoryTypeValidator = v.union(
  v.literal('fact'),
  v.literal('preference'),
  v.literal('instruction'),
  v.literal('context'),
  v.literal('relationship'),
  v.literal('episodic')
)

function emptyLayerResults() {
  return {
    platform: [] as Array<{ document: Doc<'platformMemories'>; score: number }>,
    niche: [] as Array<{ document: Doc<'nicheMemories'>; score: number }>,
    business: [] as Array<{ document: Doc<'businessMemories'>; score: number }>,
    agent: [] as Array<{ document: Doc<'agentMemories'>; score: number }>,
    totalResults: 0,
  }
}

function scheduleAccessTracking(
  ctx: { scheduler: { runAfter: (...args: any[]) => Promise<unknown> } },
  business: Array<{ document: Doc<'businessMemories'>; score: number }>,
  agent: Array<{ document: Doc<'agentMemories'>; score: number }>,
  organizationId: Doc<'organizations'>['_id']
): Promise<unknown>[] {
  const promises: Promise<unknown>[] = []
  const seenBusinessIds = new Set<string>()
  for (const mem of business) {
    const memoryId = mem.document._id
    if (seenBusinessIds.has(memoryId)) continue
    seenBusinessIds.add(memoryId)
    promises.push(
      ctx.scheduler.runAfter(0, internal.businessMemories.recordAccess, {
        id: memoryId,
        organizationId,
      })
    )
  }

  const seenAgentIds = new Set<string>()
  for (const mem of agent) {
    const memoryId = mem.document._id
    if (seenAgentIds.has(memoryId)) continue
    seenAgentIds.add(memoryId)
    promises.push(
      ctx.scheduler.runAfter(0, internal.agentMemories.recordUse, {
        id: memoryId,
        organizationId,
        wasSuccessful: true,
      })
    )
  }
  return promises
}

export const retrieveContext = action({
  args: {
    query: v.string(),
    organizationId: v.id('organizations'),
    authToken: v.optional(v.string()),
    nicheId: v.optional(v.string()),
    agentType: v.optional(v.string()),
    platformLimit: v.optional(v.number()),
    nicheLimit: v.optional(v.number()),
    businessLimit: v.optional(v.number()),
    agentLimit: v.optional(v.number()),
    keywordType: v.optional(businessMemoryTypeValidator),
    keywordSubjectType: v.optional(v.string()),
    keywordSubjectId: v.optional(v.string()),
    traceId: v.optional(v.string()),
  },
  returns: v.object({
    platform: v.array(
      v.object({
        document: v.any(),
        score: v.float64(),
      })
    ),
    niche: v.array(
      v.object({
        document: v.any(),
        score: v.float64(),
      })
    ),
    business: v.array(
      v.object({
        document: v.any(),
        score: v.float64(),
      })
    ),
    agent: v.array(
      v.object({
        document: v.any(),
        score: v.float64(),
      })
    ),
    totalResults: v.float64(),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{
    platform: Array<{ document: Doc<'platformMemories'>; score: number }>
    niche: Array<{ document: Doc<'nicheMemories'>; score: number }>
    business: Array<{ document: Doc<'businessMemories'>; score: number }>
    agent: Array<{ document: Doc<'agentMemories'>; score: number }>
    totalResults: number
  }> => {
    assertMemoryApiToken(args.authToken, 'memoryRetrieval.retrieveContext')

    if (!isEmbeddingConfigured()) {
      console.warn('[Memory] Embedding provider not configured — skipping retrieval.', {
        organizationId: args.organizationId,
      })
      return emptyLayerResults()
    }

    const hasKeywordHints = args.keywordType || args.keywordSubjectType || args.keywordSubjectId

    const vectorResults = await ctx.runAction(internal.vectorSearch.searchAllLayers, {
      query: args.query,
      organizationId: args.organizationId,
      nicheId: args.nicheId,
      agentType: args.agentType,
      platformLimit: args.platformLimit,
      nicheLimit: args.nicheLimit,
      businessLimit: args.businessLimit,
      agentLimit: args.agentLimit,
    })

    const hybridBusinessResults = hasKeywordHints
      ? await ctx.runAction(internal.hybridSearch.hybridSearchBusinessMemories, {
          query: args.query,
          organizationId: args.organizationId,
          embedding: vectorResults.embedding,
          precomputedVectorResults: vectorResults.business,
          type: args.keywordType,
          subjectType: args.keywordSubjectType,
          subjectId: args.keywordSubjectId,
          limit: args.businessLimit ?? 20,
        })
      : null

    const now = Date.now()

    const rawBusiness: Array<{ document: Doc<'businessMemories'>; score: number }> =
      hybridBusinessResults
        ? hybridBusinessResults.map((r: { document: Doc<'businessMemories'>; score: number }) => ({
            document: r.document,
            score: r.score,
          }))
        : vectorResults.business

    const business = rawBusiness.filter(
      (r) => r.document.expiresAt == null || r.document.expiresAt > now
    )

    const trackingPromises = scheduleAccessTracking(
      ctx,
      business,
      vectorResults.agent,
      args.organizationId
    )
    if (trackingPromises.length > 0) {
      await Promise.allSettled(trackingPromises)
    }

    return {
      platform: vectorResults.platform,
      niche: vectorResults.niche,
      business,
      agent: vectorResults.agent,
      totalResults:
        vectorResults.platform.length +
        vectorResults.niche.length +
        business.length +
        vectorResults.agent.length,
    }
  },
})

/**
 * Intent-aware retrieval: searches only the specified memory layers.
 * Falls back to full retrieval when `layers` is omitted or empty.
 */
export const retrieveSelectedContext = action({
  args: {
    query: v.string(),
    organizationId: v.id('organizations'),
    authToken: v.optional(v.string()),
    layers: v.array(v.string()),
    nicheId: v.optional(v.string()),
    agentType: v.optional(v.string()),
    platformLimit: v.optional(v.number()),
    nicheLimit: v.optional(v.number()),
    businessLimit: v.optional(v.number()),
    agentLimit: v.optional(v.number()),
    keywordType: v.optional(businessMemoryTypeValidator),
    keywordSubjectType: v.optional(v.string()),
    keywordSubjectId: v.optional(v.string()),
    traceId: v.optional(v.string()),
  },
  returns: v.object({
    platform: v.array(v.object({ document: v.any(), score: v.float64() })),
    niche: v.array(v.object({ document: v.any(), score: v.float64() })),
    business: v.array(v.object({ document: v.any(), score: v.float64() })),
    agent: v.array(v.object({ document: v.any(), score: v.float64() })),
    totalResults: v.float64(),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{
    platform: Array<{ document: Doc<'platformMemories'>; score: number }>
    niche: Array<{ document: Doc<'nicheMemories'>; score: number }>
    business: Array<{ document: Doc<'businessMemories'>; score: number }>
    agent: Array<{ document: Doc<'agentMemories'>; score: number }>
    totalResults: number
  }> => {
    assertMemoryApiToken(args.authToken, 'memoryRetrieval.retrieveSelectedContext')

    if (!isEmbeddingConfigured()) return emptyLayerResults()
    if (args.layers.length === 0) return emptyLayerResults()

    const layerSet = new Set(args.layers)
    const hasKeywordHints = args.keywordType || args.keywordSubjectType || args.keywordSubjectId

    const vectorResults = await ctx.runAction(internal.vectorSearch.searchSelectedLayers, {
      query: args.query,
      organizationId: args.organizationId,
      layers: args.layers,
      nicheId: args.nicheId,
      agentType: args.agentType,
      platformLimit: args.platformLimit,
      nicheLimit: args.nicheLimit,
      businessLimit: args.businessLimit,
      agentLimit: args.agentLimit,
    })

    const hybridBusinessResults =
      layerSet.has('business') && hasKeywordHints
        ? await ctx.runAction(internal.hybridSearch.hybridSearchBusinessMemories, {
            query: args.query,
            organizationId: args.organizationId,
            embedding: vectorResults.embedding,
            precomputedVectorResults: vectorResults.business,
            type: args.keywordType,
            subjectType: args.keywordSubjectType,
            subjectId: args.keywordSubjectId,
            limit: args.businessLimit ?? 20,
          })
        : null

    const now = Date.now()
    const rawBusiness: Array<{ document: Doc<'businessMemories'>; score: number }> =
      hybridBusinessResults
        ? hybridBusinessResults.map((r: { document: Doc<'businessMemories'>; score: number }) => ({
            document: r.document,
            score: r.score,
          }))
        : vectorResults.business

    const business = rawBusiness.filter(
      (r) => r.document.expiresAt == null || r.document.expiresAt > now
    )

    const trackingPromises = scheduleAccessTracking(
      ctx,
      business,
      vectorResults.agent,
      args.organizationId
    )
    if (trackingPromises.length > 0) {
      await Promise.allSettled(trackingPromises)
    }

    return {
      platform: vectorResults.platform,
      niche: vectorResults.niche,
      business,
      agent: vectorResults.agent,
      totalResults:
        vectorResults.platform.length +
        vectorResults.niche.length +
        business.length +
        vectorResults.agent.length,
    }
  },
})

/**
 * Lightweight business memory search for tool use.
 * Single-layer vector search returning structured results for display.
 */
export const searchMemories = action({
  args: {
    query: v.string(),
    organizationId: v.id('organizations'),
    authToken: v.optional(v.string()),
    type: v.optional(businessMemoryTypeValidator),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    results: v.array(
      v.object({
        id: v.string(),
        content: v.string(),
        type: v.string(),
        confidence: v.float64(),
        importance: v.float64(),
        score: v.float64(),
        subjectType: v.optional(v.string()),
        subjectName: v.optional(v.string()),
        createdAt: v.float64(),
      })
    ),
    totalResults: v.float64(),
  }),
  handler: async (ctx, args) => {
    assertMemoryApiToken(args.authToken, 'memoryRetrieval.searchMemories')

    const emptyResponse = { results: [], totalResults: 0 }
    const limit = Math.min(args.limit ?? 10, 50)

    if (!isEmbeddingConfigured()) {
      console.warn('[Memory] Embedding not configured — skipping searchMemories.', {
        organizationId: args.organizationId,
      })
      return emptyResponse
    }

    const searchResults = await ctx.runAction(internal.vectorSearch.searchBusinessMemories, {
      embedding: await ctx.runAction(internal.embedding.generateEmbedding, {
        text: args.query,
      }),
      organizationId: args.organizationId,
      limit: args.type ? limit * 3 : limit,
    })

    if (searchResults.length === 0) return emptyResponse

    const now = Date.now()
    let filtered: Array<{ document: Doc<'businessMemories'>; score: number }> = searchResults

    if (args.type) {
      filtered = filtered.filter((r) => r.document.type === args.type)
    }

    filtered = filtered.filter((r) => r.document.expiresAt == null || r.document.expiresAt > now)

    const results = filtered.slice(0, limit).map((r) => ({
      id: r.document._id as string,
      content: r.document.content,
      type: r.document.type,
      confidence: r.document.confidence,
      importance: r.document.importance,
      score: r.score,
      subjectType: r.document.subjectType ?? undefined,
      subjectName: r.document.subjectId ?? undefined,
      createdAt: r.document.createdAt,
    }))

    return { results, totalResults: results.length }
  },
})

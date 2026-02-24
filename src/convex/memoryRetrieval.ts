import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { action } from './_generated/server'
import { isEmbeddingConfigured } from './embedding'

/**
 * Memory Retrieval Action
 *
 * Public Convex action that orchestrates:
 *   1. Multi-layer parallel vector search (via searchAllLayers)
 *   2. RRF hybrid search for business memories (when subject hints provided)
 *   3. Deferred access tracking for business + agent memories (via scheduler)
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  RETRIEVAL FLOW                                                  │
 * │                                                                  │
 * │  Next.js API Route                                               │
 * │    ↓ ConvexHttpClient.action(retrieveContext, args)              │
 * │  retrieveContext (this action)                                   │
 * │    ├ ctx.runAction(searchAllLayers, ...)        ← vector path    │
 * │    └ ctx.runAction(hybridSearchBusinessMemories) ← RRF path      │
 * │  Use hybrid results for business when keyword hints present      │
 * │    ↓ ctx.scheduler.runAfter(0, recordAccess/recordUse, ...)      │
 * │  Return merged results to Next.js                                │
 * └──────────────────────────────────────────────────────────────────┘
 */

export const retrieveContext = action({
  args: {
    query: v.string(),
    organizationId: v.id('organizations'),
    nicheId: v.optional(v.string()),
    agentType: v.optional(v.string()),
    platformLimit: v.optional(v.number()),
    nicheLimit: v.optional(v.number()),
    businessLimit: v.optional(v.number()),
    agentLimit: v.optional(v.number()),
    keywordType: v.optional(
      v.union(
        v.literal('fact'),
        v.literal('preference'),
        v.literal('instruction'),
        v.literal('context'),
        v.literal('relationship'),
        v.literal('episodic')
      )
    ),
    keywordSubjectType: v.optional(v.string()),
    keywordSubjectId: v.optional(v.string()),
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
    const emptyResults = {
      platform: [] as Array<{ document: Doc<'platformMemories'>; score: number }>,
      niche: [] as Array<{ document: Doc<'nicheMemories'>; score: number }>,
      business: [] as Array<{ document: Doc<'businessMemories'>; score: number }>,
      agent: [] as Array<{ document: Doc<'agentMemories'>; score: number }>,
      totalResults: 0,
    }

    if (!isEmbeddingConfigured()) {
      console.warn('[Memory] Embedding provider not configured — skipping retrieval.', {
        organizationId: args.organizationId,
      })
      return emptyResults
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
          type: args.keywordType,
          subjectType: args.keywordSubjectType,
          subjectId: args.keywordSubjectId,
          limit: args.businessLimit ?? 20,
        })
      : null

    const now = Date.now()

    const rawBusiness: Array<{ document: Doc<'businessMemories'>; score: number }> =
      hybridBusinessResults
        ? hybridBusinessResults.map((r) => ({ document: r.document, score: r.score }))
        : vectorResults.business

    const business = rawBusiness.filter(
      (r) => r.document.expiresAt == null || r.document.expiresAt > now
    )

    const trackingPromises: Promise<unknown>[] = []
    const seenBusinessIds = new Set<string>()

    for (const mem of business) {
      const memoryId = mem.document._id
      if (seenBusinessIds.has(memoryId)) continue
      seenBusinessIds.add(memoryId)

      trackingPromises.push(
        ctx.scheduler.runAfter(0, internal.businessMemories.recordAccess, {
          id: memoryId,
          organizationId: args.organizationId,
        })
      )
    }

    const seenAgentIds = new Set<string>()
    for (const mem of vectorResults.agent) {
      const memoryId = mem.document._id
      if (seenAgentIds.has(memoryId)) continue
      seenAgentIds.add(memoryId)

      trackingPromises.push(
        ctx.scheduler.runAfter(0, internal.agentMemories.recordUse, {
          id: memoryId,
          organizationId: args.organizationId,
          wasSuccessful: true,
        })
      )
    }

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

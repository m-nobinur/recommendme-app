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
 *   2. Keyword search for business memories (when subject hints provided)
 *   3. Merging + deduplication of vector and keyword results
 *   4. Deferred access tracking for business memories (via scheduler)
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  RETRIEVAL FLOW                                                  │
 * │                                                                  │
 * │  Next.js API Route                                               │
 * │    ↓ ConvexHttpClient.action(retrieveContext, args)              │
 * │  retrieveContext (this action)                                   │
 * │    ├ ctx.runAction(searchAllLayers, ...)   ← vector path         │
 * │    └ ctx.runQuery(keywordSearchBusiness)   ← keyword path        │
 * │  Merge + deduplicate business results                            │
 * │    ↓ ctx.scheduler.runAfter(0, recordAccess, ...)               │
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
      console.warn(
        '[Memory] Embedding provider not configured — skipping retrieval. ' +
          'Set OPENROUTER_API_KEY or OPENAI_API_KEY in Convex env vars.'
      )
      return emptyResults
    }

    const hasKeywordHints = args.keywordType || (args.keywordSubjectType && args.keywordSubjectId)

    const [vectorResults, keywordResults] = await Promise.all([
      ctx.runAction(internal.vectorSearch.searchAllLayers, {
        query: args.query,
        organizationId: args.organizationId,
        nicheId: args.nicheId,
        agentType: args.agentType,
        platformLimit: args.platformLimit,
        nicheLimit: args.nicheLimit,
        businessLimit: args.businessLimit,
        agentLimit: args.agentLimit,
      }),

      hasKeywordHints
        ? ctx.runQuery(internal.hybridSearch.keywordSearchBusiness, {
            organizationId: args.organizationId,
            type: args.keywordType,
            subjectType: args.keywordSubjectType,
            subjectId: args.keywordSubjectId,
            limit: 10,
          })
        : Promise.resolve([] as Doc<'businessMemories'>[]),
    ])

    const mergedBusiness = vectorResults.business
    if (keywordResults.length > 0) {
      const vectorIds = new Set(mergedBusiness.map((r) => r.document._id))
      for (const doc of keywordResults) {
        if (!vectorIds.has(doc._id)) {
          mergedBusiness.push({ document: doc, score: 0.5 })
        }
      }
    }

    const seenBusinessIds = new Set<string>()
    const accessTrackingPromises: Promise<unknown>[] = []

    for (const mem of mergedBusiness) {
      const memoryId = mem.document._id
      if (seenBusinessIds.has(memoryId)) {
        continue
      }
      seenBusinessIds.add(memoryId)

      accessTrackingPromises.push(
        ctx.scheduler.runAfter(0, internal.businessMemories.recordAccess, {
          id: memoryId,
          organizationId: args.organizationId,
        })
      )
    }

    if (accessTrackingPromises.length > 0) {
      await Promise.allSettled(accessTrackingPromises)
    }

    return {
      platform: vectorResults.platform,
      niche: vectorResults.niche,
      business: mergedBusiness,
      agent: vectorResults.agent,
      totalResults:
        vectorResults.platform.length +
        vectorResults.niche.length +
        mergedBusiness.length +
        vectorResults.agent.length,
    }
  },
})

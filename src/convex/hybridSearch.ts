import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { internalAction, internalQuery } from './_generated/server'

/**
 * Hybrid Search (Vector + Keyword)
 *
 * Combines vector similarity search with index-based keyword/filter search
 * using Reciprocal Rank Fusion (RRF) to produce a single ranked result set.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  HYBRID SEARCH PIPELINE                                             │
 * │  ═══════════════════════                                            │
 * │                                                                     │
 * │  Query + Filters                                                    │
 * │    ├──▶ Vector Path (weight: 0.7)                                   │
 * │    │     ↓ generateEmbedding → ctx.vectorSearch                     │
 * │    │     ↓ ranked by cosine similarity                              │
 * │    │                                                                │
 * │    └──▶ Keyword Path (weight: 0.3)                                  │
 * │          ↓ index-based query (by_org_type, by_org_subject)          │
 * │          ↓ ranked by recency + importance                           │
 * │                                                                     │
 * │  Both paths → Reciprocal Rank Fusion → Deduplicate → Final Results  │
 * │                                                                     │
 * │  RRF Formula: score = Σ (weight / (k + rank_i))                     │
 * │  where k = 60 (standard constant to prevent over-weighting top)     │
 * └─────────────────────────────────────────────────────────────────────┘
 */

// ============================================
// Constants
// ============================================

const VECTOR_WEIGHT = 0.7
const KEYWORD_WEIGHT = 0.3
const RRF_K = 60 // Standard RRF constant

// ============================================
// Keyword Search (Internal Queries)
// ============================================

/**
 * Keyword-based search for business memories using existing indexes.
 * Returns memories matching type and/or subject filters, sorted by recency.
 */
export const keywordSearchBusiness = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    type: v.optional(
      v.union(
        v.literal('fact'),
        v.literal('preference'),
        v.literal('instruction'),
        v.literal('context'),
        v.literal('relationship'),
        v.literal('episodic')
      )
    ),
    subjectType: v.optional(v.string()),
    subjectId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 100)

    let results: Doc<'businessMemories'>[] = []

    if (args.subjectType && args.subjectId) {
      const subjectType = args.subjectType
      const subjectId = args.subjectId
      const candidates = await ctx.db
        .query('businessMemories')
        .withIndex('by_org_subject', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('subjectType', subjectType)
            .eq('subjectId', subjectId)
        )
        .order('desc')
        .take(limit * 3)

      results = candidates.filter((m) => m.isActive && !m.isArchived)
    } else if (args.type) {
      const memoryType = args.type
      const candidates = await ctx.db
        .query('businessMemories')
        .withIndex('by_org_type', (q) =>
          q.eq('organizationId', args.organizationId).eq('type', memoryType)
        )
        .order('desc')
        .take(limit * 3)

      results = candidates.filter((m) => m.isActive && !m.isArchived)
    } else {
      results = await ctx.db
        .query('businessMemories')
        .withIndex('by_org_active', (q) =>
          q.eq('organizationId', args.organizationId).eq('isActive', true)
        )
        .order('desc')
        .take(limit * 2)

      results = results.filter((m) => !m.isArchived)
    }

    return results.slice(0, limit)
  },
})

// ============================================
// Hybrid Search
// ============================================

/**
 * Hybrid search for business memories combining vector + keyword paths.
 *
 * Uses Reciprocal Rank Fusion (RRF) to merge results from both paths.
 * Vector path contributes 70% weight, keyword path 30%.
 */
export const hybridSearchBusinessMemories = internalAction({
  args: {
    query: v.string(),
    organizationId: v.id('organizations'),
    type: v.optional(
      v.union(
        v.literal('fact'),
        v.literal('preference'),
        v.literal('instruction'),
        v.literal('context'),
        v.literal('relationship'),
        v.literal('episodic')
      )
    ),
    subjectType: v.optional(v.string()),
    subjectId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    Array<{
      document: Doc<'businessMemories'>
      score: number
      vectorScore: number
      keywordRank: number
    }>
  > => {
    const limit = Math.min(args.limit ?? 20, 100)

    const embedding: number[] = await ctx.runAction(internal.embedding.generateEmbedding, {
      text: args.query,
    })

    const [vectorResults, keywordResults] = await Promise.all([
      ctx.runAction(internal.vectorSearch.searchBusinessMemories, {
        embedding,
        organizationId: args.organizationId,
        limit: limit * 2,
      }),

      ctx.runQuery(internal.hybridSearch.keywordSearchBusiness, {
        organizationId: args.organizationId,
        type: args.type,
        subjectType: args.subjectType,
        subjectId: args.subjectId,
        limit: limit * 2,
      }),
    ])

    // Reciprocal Rank Fusion
    // Each document gets an RRF score from each path:
    //   rrf_score = weight / (k + rank)
    const scoreMap = new Map<
      string,
      {
        document: Doc<'businessMemories'>
        rrfScore: number
        vectorScore: number
        keywordRank: number
      }
    >()

    // Score vector results
    for (let i = 0; i < vectorResults.length; i++) {
      const result = vectorResults[i]
      const docId = result.document._id
      const rrfScore = VECTOR_WEIGHT / (RRF_K + i)

      scoreMap.set(docId, {
        document: result.document,
        rrfScore,
        vectorScore: result.score,
        keywordRank: -1,
      })
    }

    // Score keyword results and merge
    for (let i = 0; i < keywordResults.length; i++) {
      const doc = keywordResults[i]
      const docId = doc._id
      const rrfScore = KEYWORD_WEIGHT / (RRF_K + i)

      const existing = scoreMap.get(docId)
      if (existing) {
        existing.rrfScore += rrfScore
        existing.keywordRank = i
      } else {
        scoreMap.set(docId, {
          document: doc,
          rrfScore,
          vectorScore: 0,
          keywordRank: i,
        })
      }
    }

    // Sort by combined RRF score and return top results
    const fusedResults = Array.from(scoreMap.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, limit)
      .map((r) => ({
        document: r.document,
        score: r.rrfScore,
        vectorScore: r.vectorScore,
        keywordRank: r.keywordRank,
      }))

    return fusedResults
  },
})

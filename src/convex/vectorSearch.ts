import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { internalAction, internalQuery } from './_generated/server'

/**
 * Vector Search Functions
 *
 * Performs semantic similarity search across all 4 memory layers using
 * Convex's native vector search. Each function:
 *   1. Takes a pre-generated embedding vector (avoids redundant embedding calls)
 *   2. Calls ctx.vectorSearch() on the appropriate table
 *   3. Fetches full documents via internal queries (parallel Promise.all)
 *   4. Returns results with similarity scores attached
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  VECTOR SEARCH PIPELINE                                             │
 * │  ═════════════════════                                              │
 * │                                                                     │
 * │  User Query                                                         │
 * │    ↓ generateEmbedding (3072 dims) — done once in searchAllLayers   │
 * │  Query Vector                                                       │
 * │    ↓ ctx.vectorSearch (per layer, with filter) — parallel           │
 * │  Ranked IDs + Scores                                                │
 * │    ↓ fetchResults (Promise.all batch document load)                 │
 * │  Full Documents + Scores                                            │
 * │    ↓ filter by similarity threshold (0.2)                           │
 * │  Final Results                                                      │
 * │                                                                     │
 * │  For multi-layer search, all 4 layers are queried in parallel       │
 * │  via Promise.all for minimum latency.                               │
 * └─────────────────────────────────────────────────────────────────────┘
 */

// ============================================
// Constants
// ============================================

/**
 * Minimum cosine similarity score to consider a result relevant.
 * Canonical value: must stay in sync with SIMILARITY_THRESHOLD in src/lib/memory/embedding.ts.
 */
const SIMILARITY_THRESHOLD = 0.2

// ============================================
// Fetch Results (Internal Queries)
// ============================================

/**
 * Fetch platform memory documents by IDs (parallel).
 */
export const fetchPlatformResults = internalQuery({
  args: { ids: v.array(v.id('platformMemories')) },
  handler: async (ctx, args) => {
    const docs = await Promise.all(args.ids.map((id) => ctx.db.get(id)))
    return docs.filter((d): d is Doc<'platformMemories'> => d !== null)
  },
})

/**
 * Fetch niche memory documents by IDs (parallel).
 */
export const fetchNicheResults = internalQuery({
  args: { ids: v.array(v.id('nicheMemories')) },
  handler: async (ctx, args) => {
    const docs = await Promise.all(args.ids.map((id) => ctx.db.get(id)))
    return docs.filter((d): d is Doc<'nicheMemories'> => d !== null)
  },
})

/**
 * Fetch business memory documents by IDs (parallel).
 */
export const fetchBusinessResults = internalQuery({
  args: { ids: v.array(v.id('businessMemories')) },
  handler: async (ctx, args) => {
    const docs = await Promise.all(args.ids.map((id) => ctx.db.get(id)))
    return docs.filter((d): d is Doc<'businessMemories'> => d !== null)
  },
})

/**
 * Fetch agent memory documents by IDs (parallel).
 */
export const fetchAgentResults = internalQuery({
  args: { ids: v.array(v.id('agentMemories')) },
  handler: async (ctx, args) => {
    const docs = await Promise.all(args.ids.map((id) => ctx.db.get(id)))
    return docs.filter((d): d is Doc<'agentMemories'> => d !== null)
  },
})

// ============================================
// Shared Helpers
// ============================================

/**
 * Attach similarity scores to fetched documents and filter by threshold.
 */
function attachScoresAndFilter<T extends { _id: string; isActive?: boolean; isArchived?: boolean }>(
  docs: T[],
  vectorResults: Array<{ _id: string; _score: number }>,
  layerName?: string
): Array<{ document: T; score: number }> {
  const scoreMap = new Map(vectorResults.map((r) => [r._id, r._score]))

  if (vectorResults.length > 0 && process.env.DEBUG_MEMORY === 'true') {
    console.log(`[VectorSearch] ${layerName ?? 'unknown'}:`, {
      count: vectorResults.length,
      minScore: Math.min(...vectorResults.map((r) => r._score)).toFixed(4),
      maxScore: Math.max(...vectorResults.map((r) => r._score)).toFixed(4),
    })
  }

  const results: Array<{ document: T; score: number }> = []
  for (const doc of docs) {
    if ('isActive' in doc && doc.isActive === false) continue
    if ('isArchived' in doc && doc.isArchived === true) continue
    const score = scoreMap.get(doc._id) ?? 0
    if (score >= SIMILARITY_THRESHOLD) {
      results.push({ document: doc, score })
    }
  }

  return results
}

// ============================================
// Per-Layer Search Functions
// ============================================

/**
 * Search platform memories.
 * Filter: only active memories.
 */
export const searchPlatformMemories = internalAction({
  args: {
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<Array<{ document: Doc<'platformMemories'>; score: number }>> => {
    const limit = Math.min(args.limit ?? 5, 256)

    const vectorResults = await ctx.vectorSearch('platformMemories', 'by_embedding', {
      vector: args.embedding,
      limit,
      filter: (q) => q.eq('isActive', true),
    })

    if (vectorResults.length === 0) return []

    const docs: Doc<'platformMemories'>[] = await ctx.runQuery(
      internal.vectorSearch.fetchPlatformResults,
      { ids: vectorResults.map((r) => r._id) }
    )

    return attachScoresAndFilter(docs, vectorResults, 'platform')
  },
})

/**
 * Search niche memories.
 * Filter: by nicheId.
 */
export const searchNicheMemories = internalAction({
  args: {
    embedding: v.array(v.float64()),
    nicheId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Array<{ document: Doc<'nicheMemories'>; score: number }>> => {
    const limit = Math.min(args.limit ?? 10, 256)

    const vectorResults = await ctx.vectorSearch('nicheMemories', 'by_embedding', {
      vector: args.embedding,
      limit,
      filter: (q) => q.eq('nicheId', args.nicheId),
    })

    if (vectorResults.length === 0) return []

    const docs: Doc<'nicheMemories'>[] = await ctx.runQuery(
      internal.vectorSearch.fetchNicheResults,
      { ids: vectorResults.map((r) => r._id) }
    )

    return attachScoresAndFilter(docs, vectorResults, 'niche')
  },
})

/**
 * Search business memories.
 * Filter: by organizationId (tenant isolation).
 */
export const searchBusinessMemories = internalAction({
  args: {
    embedding: v.array(v.float64()),
    organizationId: v.id('organizations'),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<Array<{ document: Doc<'businessMemories'>; score: number }>> => {
    const limit = Math.min(args.limit ?? 20, 256)

    const vectorResults = await ctx.vectorSearch('businessMemories', 'by_embedding', {
      vector: args.embedding,
      limit,
      filter: (q) => q.eq('organizationId', args.organizationId),
    })

    if (vectorResults.length === 0) return []

    const docs: Doc<'businessMemories'>[] = await ctx.runQuery(
      internal.vectorSearch.fetchBusinessResults,
      { ids: vectorResults.map((r) => r._id) }
    )

    return attachScoresAndFilter(docs, vectorResults, 'business')
  },
})

/**
 * Search agent memories.
 * Filter: by organizationId (tenant isolation).
 * Optional agentType post-filter for narrower results.
 */
export const searchAgentMemories = internalAction({
  args: {
    embedding: v.array(v.float64()),
    organizationId: v.id('organizations'),
    agentType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Array<{ document: Doc<'agentMemories'>; score: number }>> => {
    const requestedLimit = Math.min(args.limit ?? 10, 256)
    const vectorLimit = args.agentType
      ? Math.min(Math.max(requestedLimit * 5, requestedLimit + 10), 256)
      : requestedLimit

    const vectorResults = await ctx.vectorSearch('agentMemories', 'by_embedding', {
      vector: args.embedding,
      limit: vectorLimit,
      filter: (q) => q.eq('organizationId', args.organizationId),
    })

    if (vectorResults.length === 0) return []

    const docs: Doc<'agentMemories'>[] = await ctx.runQuery(
      internal.vectorSearch.fetchAgentResults,
      { ids: vectorResults.map((r) => r._id) }
    )

    let results = attachScoresAndFilter(docs, vectorResults, 'agent')

    if (args.agentType) {
      results = results.filter((r) => r.document.agentType === args.agentType)
    }

    return results.slice(0, requestedLimit)
  },
})

// ============================================
// Multi-Layer Search (All Layers in Parallel)
// ============================================

/**
 * Search across all memory layers in parallel.
 * Returns categorized results from each layer.
 *
 * Generates the query embedding once, then passes it to all per-layer
 * searches — avoids 4 redundant embedding API calls.
 */
export const searchAllLayers = internalAction({
  args: {
    query: v.string(),
    organizationId: v.id('organizations'),
    nicheId: v.optional(v.string()),
    agentType: v.optional(v.string()),
    platformLimit: v.optional(v.number()),
    nicheLimit: v.optional(v.number()),
    businessLimit: v.optional(v.number()),
    agentLimit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    platform: Array<{ document: Doc<'platformMemories'>; score: number }>
    niche: Array<{ document: Doc<'nicheMemories'>; score: number }>
    business: Array<{ document: Doc<'businessMemories'>; score: number }>
    agent: Array<{ document: Doc<'agentMemories'>; score: number }>
    embedding: number[]
    totalResults: number
  }> => {
    const embedding: number[] = await ctx.runAction(internal.embedding.generateEmbedding, {
      text: args.query,
    })

    const [platformResults, nicheResults, businessResults, agentResults] = await Promise.all([
      ctx.runAction(internal.vectorSearch.searchPlatformMemories, {
        embedding,
        limit: args.platformLimit ?? 5,
      }),

      args.nicheId
        ? ctx.runAction(internal.vectorSearch.searchNicheMemories, {
            embedding,
            nicheId: args.nicheId,
            limit: args.nicheLimit ?? 10,
          })
        : Promise.resolve([]),

      ctx.runAction(internal.vectorSearch.searchBusinessMemories, {
        embedding,
        organizationId: args.organizationId,
        limit: args.businessLimit ?? 20,
      }),

      ctx.runAction(internal.vectorSearch.searchAgentMemories, {
        embedding,
        organizationId: args.organizationId,
        agentType: args.agentType,
        limit: args.agentLimit ?? 10,
      }),
    ])

    return {
      platform: platformResults,
      niche: nicheResults,
      business: businessResults,
      agent: agentResults,
      embedding,
      totalResults:
        platformResults.length + nicheResults.length + businessResults.length + agentResults.length,
    }
  },
})

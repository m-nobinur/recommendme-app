import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { buildEmbeddingClusters, dominantValue } from './lib/clusterBuilder'
import { isCronDisabled } from './lib/cronGuard'
import { listAllOrganizationIds } from './lib/orgHelpers'
import { callLLMWithUsage, type ResolvedLLMProvider, resolveLLMProvider } from './llmProvider'

/**
 * Memory Consolidation Worker (Phase 8.4)
 *
 * Merges near-duplicate business memories to prevent table bloat and
 * improve retrieval quality. Uses embedding similarity to find clusters
 * of overlapping memories, then LLM-summarizes each cluster into one.
 *
 * Flow:
 *   1. Per org: fetch active business memories with embeddings
 *   2. Pairwise cosine similarity → identify clusters (threshold: 0.85)
 *   3. For each cluster: LLM-summarize → insert consolidated memory → deactivate sources
 *
 * Schedule: daily at 08:30 UTC (after archival + compression)
 */

const SIMILARITY_THRESHOLD = 0.85
const MAX_MEMORIES_PER_ORG = 200
const MAX_MERGES_PER_ORG = 20
const MAX_MERGES_PER_RUN = 50
const MIN_CLUSTER_SIZE = 2

interface MemoryWithEmbedding {
  _id: Id<'businessMemories'>
  type: string
  content: string
  embedding: number[]
  importance: number
  confidence: number
  accessCount: number
  subjectType?: string
  subjectId?: string
}

export const getConsolidationCandidates = internalQuery({
  args: { organizationId: v.id('organizations'), limit: v.number() },
  handler: async (ctx, args): Promise<MemoryWithEmbedding[]> => {
    const results: MemoryWithEmbedding[] = []
    let cursor: string | null = null

    do {
      const page = await ctx.db
        .query('businessMemories')
        .withIndex('by_org_active', (q) =>
          q.eq('organizationId', args.organizationId).eq('isActive', true)
        )
        .paginate({ numItems: 100, cursor })

      for (const m of page.page) {
        if (m.embedding && !m.isArchived) {
          results.push({
            _id: m._id,
            type: m.type,
            content: m.content,
            embedding: m.embedding,
            importance: m.importance,
            confidence: m.confidence,
            accessCount: m.accessCount,
            subjectType: m.subjectType ?? undefined,
            subjectId: m.subjectId ?? undefined,
          })
        }
        if (results.length >= args.limit) break
      }

      cursor = page.isDone || results.length >= args.limit ? null : page.continueCursor
    } while (cursor)

    return results
  },
})

export const mergeCluster = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    type: v.union(
      v.literal('fact'),
      v.literal('preference'),
      v.literal('instruction'),
      v.literal('context'),
      v.literal('relationship'),
      v.literal('episodic')
    ),
    content: v.string(),
    importance: v.float64(),
    confidence: v.float64(),
    accessCount: v.number(),
    subjectType: v.optional(v.string()),
    subjectId: v.optional(v.string()),
    sourceIds: v.array(v.id('businessMemories')),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const { sourceIds, ...data } = args

    const id = await ctx.db.insert('businessMemories', {
      ...data,
      decayScore: 0.7,
      lastAccessedAt: now,
      source: 'system' as const,
      isActive: true,
      isArchived: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })

    let deactivated = 0
    for (const sourceId of sourceIds) {
      const mem = await ctx.db.get(sourceId)
      if (mem?.isActive) {
        await ctx.db.patch(sourceId, { isActive: false, updatedAt: now })
        deactivated++
      }
    }

    await ctx.scheduler.runAfter(0, internal.embedding.generateAndStore, {
      tableName: 'businessMemories' as const,
      documentId: id,
      content: args.content,
    })

    return { id, deactivated }
  },
})

async function summarizeCluster(
  provider: ResolvedLLMProvider,
  memories: MemoryWithEmbedding[]
): Promise<string> {
  const systemPrompt = `You are a memory consolidation system. Merge overlapping memories into one concise entry.
Preserve the most important facts, preferences, and context from all source memories.
The result must be self-contained and understandable without the originals.`

  const userPrompt = `Consolidate these ${memories.length} related memories into a single memory entry (50-300 characters):

${memories.map((m, i) => `${i + 1}. [${m.type}] ${m.content}`).join('\n')}

Respond with JSON: { "content": "the consolidated memory text" }`

  const result = await callLLMWithUsage(provider, systemPrompt, userPrompt, 0.3, 300)
  const parsed = result.content as { content?: string }
  const content = parsed?.content?.trim()

  if (!content || content.length < 10) {
    throw new Error('LLM returned empty or too-short consolidation result')
  }

  return content
}

/**
 * Main consolidation entry point. Runs daily via cron.
 */
export const runConsolidation = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{ totalMerged: number; clustersProcessed: number; orgsProcessed: number }> => {
    if (isCronDisabled()) return { totalMerged: 0, clustersProcessed: 0, orgsProcessed: 0 }

    const provider = resolveLLMProvider({ throwOnMissing: false })
    if (!provider) {
      console.warn('[Consolidation] Skipping — no LLM provider configured')
      return { totalMerged: 0, clustersProcessed: 0, orgsProcessed: 0 }
    }

    const orgIds = await listAllOrganizationIds(ctx)
    let totalMerged = 0
    let clustersProcessed = 0

    for (const orgId of orgIds) {
      if (totalMerged >= MAX_MERGES_PER_RUN) break

      const candidates: MemoryWithEmbedding[] = await ctx.runQuery(
        internal.memoryConsolidation.getConsolidationCandidates,
        { organizationId: orgId, limit: MAX_MEMORIES_PER_ORG }
      )

      if (candidates.length < MIN_CLUSTER_SIZE) continue

      const clusters = buildEmbeddingClusters(candidates, SIMILARITY_THRESHOLD, MIN_CLUSTER_SIZE)
      let orgMerges = 0

      for (const cluster of clusters) {
        if (orgMerges >= MAX_MERGES_PER_ORG || totalMerged >= MAX_MERGES_PER_RUN) break

        try {
          const content = await summarizeCluster(provider, cluster)

          let totalConfidence = 0
          let totalAccess = 0
          for (const m of cluster) {
            totalConfidence += m.confidence
            totalAccess += m.accessCount
          }

          const validTypes = [
            'fact',
            'preference',
            'instruction',
            'context',
            'relationship',
            'episodic',
          ] as const
          const rawType = dominantValue(cluster, (m) => m.type, 'fact')
          const resolvedType = validTypes.includes(rawType as any)
            ? (rawType as (typeof validTypes)[number])
            : 'fact'

          const withSubjects = cluster.filter((m) => m.subjectType && m.subjectId)
          const subjectKey =
            withSubjects.length > 0
              ? dominantValue(withSubjects, (m) => `${m.subjectType}::${m.subjectId}`, '')
              : ''
          const [resolvedSubjectType, resolvedSubjectId] = subjectKey
            ? subjectKey.split('::')
            : [undefined, undefined]

          await ctx.runMutation(internal.memoryConsolidation.mergeCluster, {
            organizationId: orgId,
            type: resolvedType,
            content,
            importance: Math.max(...cluster.map((m) => m.importance)),
            confidence: totalConfidence / cluster.length,
            accessCount: totalAccess,
            subjectType: resolvedSubjectType,
            subjectId: resolvedSubjectId,
            sourceIds: cluster.map((m) => m._id),
          })

          orgMerges++
          totalMerged++
          clustersProcessed++
        } catch (error) {
          console.error(
            `[Consolidation] Failed to merge cluster of ${cluster.length} for org ${orgId}:`,
            error instanceof Error ? error.message : error
          )
        }
      }
    }

    if (totalMerged > 0) {
      console.log(
        `[Consolidation] Merged ${totalMerged} clusters across ${orgIds.length} orgs (${clustersProcessed} clusters)`
      )
    }

    return { totalMerged, clustersProcessed, orgsProcessed: orgIds.length }
  },
})

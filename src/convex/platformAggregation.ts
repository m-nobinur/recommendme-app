import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { isCronDisabled } from './lib/cronGuard'
import { cosineSimilarity } from './lib/vectorMath'
import { callLLMWithUsage, resolveLLMProvider } from './llmProvider'

/**
 * Platform Aggregation Worker (Phase 8.6)
 *
 * Promotes recurring niche-level patterns into platform-level universal knowledge.
 * Platform memories affect ALL users, so candidates require human validation
 * before activation — they are created with isActive=false.
 *
 * Flow:
 *   1. Fetch high-confidence niche memories across all niches
 *   2. Cluster by embedding similarity (threshold: 0.85)
 *   3. Promote clusters present in >= MIN_NICHES distinct niches
 *   4. Generalize via LLM (remove industry-specific language)
 *   5. Create platform memory CANDIDATE (isActive=false, needs review)
 *
 * Schedule: weekly, Sunday at 07:00 UTC
 */

const SIMILARITY_THRESHOLD = 0.85
const MIN_NICHES_FOR_PROMOTION = 2
const MIN_CONFIDENCE_FOR_PROMOTION = 0.9
const MAX_PROMOTIONS_PER_RUN = 10
const PLATFORM_DEDUP_THRESHOLD = 0.9

interface NicheMemoryWithEmbedding {
  _id: Id<'nicheMemories'>
  nicheId: string
  category: string
  content: string
  embedding: number[]
  confidence: number
  contributorCount: number
}

interface PlatformCluster {
  memories: NicheMemoryWithEmbedding[]
  distinctNiches: Set<string>
  avgConfidence: number
  totalContributors: number
}

const ORG_PAGE_SIZE = 100

export const getAllActiveNicheMemories = internalQuery({
  args: {},
  handler: async (ctx): Promise<NicheMemoryWithEmbedding[]> => {
    const results: NicheMemoryWithEmbedding[] = []
    const allNicheIds = new Set<string>()

    let cursor: string | null = null
    do {
      const page = await ctx.db
        .query('organizations')
        .withIndex('by_created')
        .paginate({ numItems: ORG_PAGE_SIZE, cursor })

      for (const org of page.page) {
        if (org.settings?.nicheId) allNicheIds.add(org.settings.nicheId)
      }

      cursor = page.isDone ? null : page.continueCursor
    } while (cursor)

    for (const nicheId of allNicheIds) {
      const memories = await ctx.db
        .query('nicheMemories')
        .withIndex('by_niche_active', (q) => q.eq('nicheId', nicheId).eq('isActive', true))
        .take(100)

      for (const m of memories) {
        if (m.embedding && m.confidence >= MIN_CONFIDENCE_FOR_PROMOTION) {
          results.push({
            _id: m._id,
            nicheId: m.nicheId,
            category: m.category,
            content: m.content,
            embedding: m.embedding,
            confidence: m.confidence,
            contributorCount: m.contributorCount,
          })
        }
      }
    }

    return results
  },
})

export const getExistingPlatformEmbeddings = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ id: Id<'platformMemories'>; embedding: number[] }[]> => {
    const memories = await ctx.db
      .query('platformMemories')
      .withIndex('by_active', (q) => q.eq('isActive', true))
      .take(200)

    return memories
      .filter((m): m is typeof m & { embedding: number[] } => !!m.embedding)
      .map((m) => ({ id: m._id, embedding: m.embedding }))
  },
})

export const getPendingPlatformCandidates = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ id: Id<'platformMemories'>; embedding: number[] }[]> => {
    const memories = await ctx.db
      .query('platformMemories')
      .withIndex('by_active', (q) => q.eq('isActive', false))
      .take(100)

    return memories
      .filter((m): m is typeof m & { embedding: number[] } => !!m.embedding)
      .map((m) => ({ id: m._id, embedding: m.embedding }))
  },
})

export const createPlatformCandidate = internalMutation({
  args: {
    category: v.union(
      v.literal('sales'),
      v.literal('scheduling'),
      v.literal('pricing'),
      v.literal('communication'),
      v.literal('followup')
    ),
    content: v.string(),
    confidence: v.float64(),
    sourceCount: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    const id = await ctx.db.insert('platformMemories', {
      category: args.category,
      content: args.content,
      confidence: args.confidence,
      sourceCount: args.sourceCount,
      isActive: false,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.scheduler.runAfter(0, internal.embedding.generateAndStore, {
      tableName: 'platformMemories' as const,
      documentId: id,
      content: args.content,
    })

    return id
  },
})

function buildPlatformClusters(memories: NicheMemoryWithEmbedding[]): PlatformCluster[] {
  const parent = new Map<string, string>()

  function find(id: string): string {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root) ?? root
    let current = id
    while (current !== root) {
      const next = parent.get(current) ?? current
      parent.set(current, root)
      current = next
    }
    return root
  }

  function union(a: string, b: string) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const m of memories) parent.set(m._id, m._id)

  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const sim = cosineSimilarity(memories[i].embedding, memories[j].embedding)
      if (sim >= SIMILARITY_THRESHOLD) {
        union(memories[i]._id, memories[j]._id)
      }
    }
  }

  const groups = new Map<string, NicheMemoryWithEmbedding[]>()
  for (const m of memories) {
    const root = find(m._id)
    const group = groups.get(root) ?? []
    group.push(m)
    groups.set(root, group)
  }

  const clusters: PlatformCluster[] = []
  for (const group of groups.values()) {
    const distinctNiches = new Set(group.map((m) => m.nicheId))
    const avgConfidence = group.reduce((sum, m) => sum + m.confidence, 0) / group.length
    const totalContributors = group.reduce((sum, m) => sum + m.contributorCount, 0)

    if (
      distinctNiches.size >= MIN_NICHES_FOR_PROMOTION &&
      avgConfidence >= MIN_CONFIDENCE_FOR_PROMOTION
    ) {
      clusters.push({ memories: group, distinctNiches, avgConfidence, totalContributors })
    }
  }

  return clusters.sort((a, b) => b.distinctNiches.size - a.distinctNiches.size)
}

const NICHE_CATEGORY_TO_PLATFORM: Record<string, string> = {
  best_practice: 'communication',
  industry_norm: 'pricing',
  pattern: 'followup',
  insight: 'sales',
}

function mapToPlatformCategory(
  nicheCategory: string
): 'sales' | 'scheduling' | 'pricing' | 'communication' | 'followup' {
  const mapped = NICHE_CATEGORY_TO_PLATFORM[nicheCategory]
  if (mapped && ['sales', 'scheduling', 'pricing', 'communication', 'followup'].includes(mapped)) {
    return mapped as 'sales' | 'scheduling' | 'pricing' | 'communication' | 'followup'
  }
  return 'communication'
}

export const runPlatformAggregation = internalAction({
  args: {},
  handler: async (ctx): Promise<{ candidates: number; nichesRepresented: number }> => {
    if (isCronDisabled()) return { candidates: 0, nichesRepresented: 0 }

    const provider = resolveLLMProvider({ throwOnMissing: false })
    if (!provider) {
      console.warn('[PlatformAggregation] Skipping — no LLM provider configured')
      return { candidates: 0, nichesRepresented: 0 }
    }

    const nicheMemories = (await ctx.runQuery(
      internal.platformAggregation.getAllActiveNicheMemories,
      {}
    )) as NicheMemoryWithEmbedding[]

    if (nicheMemories.length < MIN_NICHES_FOR_PROMOTION) {
      return { candidates: 0, nichesRepresented: 0 }
    }

    const clusters = buildPlatformClusters(nicheMemories)
    if (clusters.length === 0) {
      return { candidates: 0, nichesRepresented: 0 }
    }

    const existingActive = (await ctx.runQuery(
      internal.platformAggregation.getExistingPlatformEmbeddings,
      {}
    )) as { id: Id<'platformMemories'>; embedding: number[] }[]

    const existingPending = (await ctx.runQuery(
      internal.platformAggregation.getPendingPlatformCandidates,
      {}
    )) as { id: Id<'platformMemories'>; embedding: number[] }[]

    const allExisting = [...existingActive, ...existingPending]

    let candidates = 0
    const allNiches = new Set<string>()

    for (const cluster of clusters) {
      if (candidates >= MAX_PROMOTIONS_PER_RUN) break

      try {
        const systemPrompt = `You are a universal best practices generator. Given insights from multiple industries, create a single universal business practice.
Remove ALL industry-specific language. The result should apply to ANY service business.
Focus on timeless principles of customer service, communication, and business operations.`

        const userPrompt = `These insights come from ${cluster.distinctNiches.size} different industries (${Array.from(cluster.distinctNiches).join(', ')}):

${cluster.memories.map((m, i) => `${i + 1}. [${m.nicheId}] ${m.content}`).join('\n')}

Create one universal business best practice (50-250 characters).
Respond with JSON: { "content": "the universal best practice" }`

        const result = await callLLMWithUsage(provider, systemPrompt, userPrompt, 0.3, 250)
        const parsed = result.content as { content?: string }
        const content = parsed?.content?.trim()

        if (!content || content.length < 10) continue

        const embeddingResult = (await ctx.runAction(internal.embedding.generateEmbedding, {
          text: content,
        })) as number[]

        let isDuplicate = false
        if (embeddingResult && allExisting.length > 0) {
          for (const existing of allExisting) {
            const sim = cosineSimilarity(embeddingResult, existing.embedding)
            if (sim >= PLATFORM_DEDUP_THRESHOLD) {
              isDuplicate = true
              break
            }
          }
        }

        if (isDuplicate) continue

        const categoryCounts = new Map<string, number>()
        for (const m of cluster.memories) {
          categoryCounts.set(m.category, (categoryCounts.get(m.category) ?? 0) + 1)
        }
        let dominantCategory = 'pattern'
        let maxCount = 0
        for (const [cat, count] of categoryCounts) {
          if (count > maxCount) {
            dominantCategory = cat
            maxCount = count
          }
        }

        await ctx.runMutation(internal.platformAggregation.createPlatformCandidate, {
          category: mapToPlatformCategory(dominantCategory),
          content,
          confidence: cluster.avgConfidence,
          sourceCount: cluster.totalContributors,
        })

        candidates++
        for (const nicheId of cluster.distinctNiches) {
          allNiches.add(nicheId)
        }
      } catch (error) {
        console.error(
          '[PlatformAggregation] Failed to promote cluster:',
          error instanceof Error ? error.message : error
        )
      }
    }

    if (candidates > 0) {
      console.log(
        `[PlatformAggregation] Created ${candidates} platform candidates from ${allNiches.size} niches (require admin review)`
      )
    }

    return { candidates, nichesRepresented: allNiches.size }
  },
})

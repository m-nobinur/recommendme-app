import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { isCronDisabled } from './lib/cronGuard'
import { cosineSimilarity } from './lib/vectorMath'
import { callLLMWithUsage, resolveLLMProvider } from './llmProvider'

/**
 * Niche Aggregation Worker (Phase 8.5)
 *
 * Promotes recurring business-level patterns into niche-level knowledge.
 * Cross-org learning is the core value proposition: when multiple businesses
 * in the same industry discover the same pattern, it becomes shared niche knowledge.
 *
 * Flow:
 *   1. Group orgs by nicheId
 *   2. For each niche with >= MIN_ORGS_PER_NICHE:
 *      a. Fetch high-confidence business memories across all orgs in the niche
 *      b. Cluster by embedding similarity (threshold: 0.80)
 *      c. Promote clusters meeting threshold:
 *         - Present in >= MIN_ORGS_FOR_PROMOTION distinct orgs
 *         - Average confidence >= 0.85
 *      d. Anonymize via LLM (strip org-specific details)
 *      e. Create/update niche memory
 *
 * Schedule: daily at 09:00 UTC
 */

const SIMILARITY_THRESHOLD = 0.8
const MIN_ORGS_PER_NICHE = 2
const MIN_ORGS_FOR_PROMOTION = 2
const MIN_CONFIDENCE_FOR_PROMOTION = 0.85
const MAX_MEMORIES_PER_ORG = 100
const MAX_MEMORIES_PER_NICHE = 500
const MAX_PROMOTIONS_PER_RUN = 30
const NICHE_DEDUP_THRESHOLD = 0.88
const ORG_PAGE_SIZE = 100

interface OrgMemory {
  _id: Id<'businessMemories'>
  organizationId: Id<'organizations'>
  type: string
  content: string
  embedding: number[]
  confidence: number
  importance: number
}

interface NicheCluster {
  memories: OrgMemory[]
  distinctOrgs: Set<string>
  avgConfidence: number
}

export const getOrgsByNiche = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ nicheId: string; orgIds: Id<'organizations'>[] }[]> => {
    const nicheMap = new Map<string, Id<'organizations'>[]>()
    let cursor: string | null = null

    do {
      const page = await ctx.db
        .query('organizations')
        .withIndex('by_created')
        .paginate({ numItems: ORG_PAGE_SIZE, cursor })

      for (const org of page.page) {
        const nicheId = org.settings?.nicheId
        if (!nicheId) continue
        const existing = nicheMap.get(nicheId) ?? []
        existing.push(org._id)
        nicheMap.set(nicheId, existing)
      }

      cursor = page.isDone ? null : page.continueCursor
    } while (cursor)

    return Array.from(nicheMap.entries())
      .filter(([_, orgIds]) => orgIds.length >= MIN_ORGS_PER_NICHE)
      .map(([nicheId, orgIds]) => ({ nicheId, orgIds }))
  },
})

export const getHighConfidenceMemories = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    minConfidence: v.float64(),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<OrgMemory[]> => {
    const results: OrgMemory[] = []
    let cursor: string | null = null

    do {
      const page = await ctx.db
        .query('businessMemories')
        .withIndex('by_org_active', (q) =>
          q.eq('organizationId', args.organizationId).eq('isActive', true)
        )
        .paginate({ numItems: 100, cursor })

      for (const m of page.page) {
        if (m.embedding && m.confidence >= args.minConfidence && !m.isArchived) {
          results.push({
            _id: m._id,
            organizationId: m.organizationId,
            type: m.type,
            content: m.content,
            embedding: m.embedding,
            confidence: m.confidence,
            importance: m.importance,
          })
        }
        if (results.length >= args.limit) break
      }

      cursor = page.isDone || results.length >= args.limit ? null : page.continueCursor
    } while (cursor)

    return results
  },
})

export const getExistingNicheEmbeddings = internalQuery({
  args: { nicheId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ id: Id<'nicheMemories'>; embedding: number[]; content: string }[]> => {
    const memories = await ctx.db
      .query('nicheMemories')
      .withIndex('by_niche_active', (q) => q.eq('nicheId', args.nicheId).eq('isActive', true))
      .take(200)

    return memories
      .filter((m): m is typeof m & { embedding: number[] } => !!m.embedding)
      .map((m) => ({ id: m._id, embedding: m.embedding, content: m.content }))
  },
})

export const upsertNicheMemory = internalMutation({
  args: {
    nicheId: v.string(),
    existingId: v.optional(v.id('nicheMemories')),
    category: v.string(),
    content: v.string(),
    confidence: v.float64(),
    contributorCount: v.number(),
  },
  handler: async (ctx, args): Promise<Id<'nicheMemories'>> => {
    if (args.existingId) {
      const existing = await ctx.db.get(args.existingId)
      if (existing) {
        await ctx.db.patch(args.existingId, {
          content: args.content,
          confidence: Math.max(existing.confidence, args.confidence),
          contributorCount: args.contributorCount,
          updatedAt: Date.now(),
        })
        await ctx.scheduler.runAfter(0, internal.embedding.generateAndStore, {
          tableName: 'nicheMemories' as const,
          documentId: args.existingId,
          content: args.content,
        })
        return args.existingId
      }
    }

    const now = Date.now()
    const id = await ctx.db.insert('nicheMemories', {
      nicheId: args.nicheId,
      category: args.category,
      content: args.content,
      confidence: args.confidence,
      contributorCount: args.contributorCount,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.scheduler.runAfter(0, internal.embedding.generateAndStore, {
      tableName: 'nicheMemories' as const,
      documentId: id,
      content: args.content,
    })

    return id
  },
})

function buildNicheClusters(memories: OrgMemory[]): NicheCluster[] {
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

  const groups = new Map<string, OrgMemory[]>()
  for (const m of memories) {
    const root = find(m._id)
    const group = groups.get(root) ?? []
    group.push(m)
    groups.set(root, group)
  }

  const clusters: NicheCluster[] = []
  for (const group of groups.values()) {
    const distinctOrgs = new Set(group.map((m) => m.organizationId as string))
    const avgConfidence = group.reduce((sum, m) => sum + m.confidence, 0) / group.length

    if (
      distinctOrgs.size >= MIN_ORGS_FOR_PROMOTION &&
      avgConfidence >= MIN_CONFIDENCE_FOR_PROMOTION
    ) {
      clusters.push({ memories: group, distinctOrgs, avgConfidence })
    }
  }

  return clusters.sort((a, b) => b.distinctOrgs.size - a.distinctOrgs.size)
}

function mapTypeToNicheCategory(type: string): string {
  switch (type) {
    case 'instruction':
    case 'preference':
      return 'best_practice'
    case 'fact':
      return 'industry_norm'
    case 'relationship':
      return 'pattern'
    case 'context':
    case 'episodic':
      return 'insight'
    default:
      return 'pattern'
  }
}

export const runNicheAggregation = internalAction({
  args: {},
  handler: async (ctx): Promise<{ promoted: number; nichesProcessed: number }> => {
    if (isCronDisabled()) return { promoted: 0, nichesProcessed: 0 }

    const provider = resolveLLMProvider({ throwOnMissing: false })
    if (!provider) {
      console.warn('[NicheAggregation] Skipping — no LLM provider configured')
      return { promoted: 0, nichesProcessed: 0 }
    }

    const niches = (await ctx.runQuery(internal.nicheAggregation.getOrgsByNiche, {})) as {
      nicheId: string
      orgIds: Id<'organizations'>[]
    }[]

    let promoted = 0
    let nichesProcessed = 0

    for (const niche of niches) {
      if (promoted >= MAX_PROMOTIONS_PER_RUN) break

      const allMemories: OrgMemory[] = []
      for (const orgId of niche.orgIds) {
        if (allMemories.length >= MAX_MEMORIES_PER_NICHE) break
        const orgMemories: OrgMemory[] = await ctx.runQuery(
          internal.nicheAggregation.getHighConfidenceMemories,
          {
            organizationId: orgId,
            minConfidence: MIN_CONFIDENCE_FOR_PROMOTION,
            limit: Math.min(MAX_MEMORIES_PER_ORG, MAX_MEMORIES_PER_NICHE - allMemories.length),
          }
        )
        allMemories.push(...orgMemories)
      }

      if (allMemories.length >= MAX_MEMORIES_PER_NICHE) {
        console.warn(
          `[NicheAggregation] Niche ${niche.nicheId} capped at ${MAX_MEMORIES_PER_NICHE} memories (${niche.orgIds.length} orgs)`
        )
      }

      if (allMemories.length < MIN_ORGS_FOR_PROMOTION) continue

      const clusters = buildNicheClusters(allMemories)
      const existingNiche = (await ctx.runQuery(
        internal.nicheAggregation.getExistingNicheEmbeddings,
        { nicheId: niche.nicheId }
      )) as { id: Id<'nicheMemories'>; embedding: number[]; content: string }[]

      for (const cluster of clusters) {
        if (promoted >= MAX_PROMOTIONS_PER_RUN) break

        try {
          const systemPrompt = `You are an industry knowledge aggregator. Given memories from multiple businesses in the same industry, create a single anonymized industry-level insight.
Remove ALL business-specific names, amounts, dates, and identifiers.
The result should be a universal industry pattern or best practice.`

          const userPrompt = `Aggregate these ${cluster.memories.length} business memories from ${cluster.distinctOrgs.size} different businesses into one anonymized industry insight (50-300 characters):

${cluster.memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n')}

Respond with JSON: { "content": "the anonymized industry insight" }`

          const result = await callLLMWithUsage(provider, systemPrompt, userPrompt, 0.3, 300)
          const parsed = result.content as { content?: string }
          const content = parsed?.content?.trim()

          if (!content || content.length < 10) continue

          const embeddingResult = (await ctx.runAction(internal.embedding.generateEmbedding, {
            text: content,
          })) as number[]

          let existingId: Id<'nicheMemories'> | undefined
          if (embeddingResult && existingNiche.length > 0) {
            for (const existing of existingNiche) {
              const sim = cosineSimilarity(embeddingResult, existing.embedding)
              if (sim >= NICHE_DEDUP_THRESHOLD) {
                existingId = existing.id
                break
              }
            }
          }

          const typeCounts = new Map<string, number>()
          for (const m of cluster.memories) {
            typeCounts.set(m.type, (typeCounts.get(m.type) ?? 0) + 1)
          }
          let dominantType = 'fact'
          let maxCount = 0
          for (const [type, count] of typeCounts) {
            if (count > maxCount) {
              dominantType = type
              maxCount = count
            }
          }

          await ctx.runMutation(internal.nicheAggregation.upsertNicheMemory, {
            nicheId: niche.nicheId,
            existingId,
            category: mapTypeToNicheCategory(dominantType),
            content,
            confidence: cluster.avgConfidence,
            contributorCount: cluster.distinctOrgs.size,
          })

          promoted++
        } catch (error) {
          console.error(
            `[NicheAggregation] Failed to promote cluster for niche ${niche.nicheId}:`,
            error instanceof Error ? error.message : error
          )
        }
      }

      nichesProcessed++
    }

    if (promoted > 0) {
      console.log(
        `[NicheAggregation] Promoted ${promoted} patterns across ${nichesProcessed} niches`
      )
    }

    return { promoted, nichesProcessed }
  },
})

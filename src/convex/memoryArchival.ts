import { ActionRetrier } from '@convex-dev/action-retrier'
import { ConvexError, v } from 'convex/values'
import { components, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from './_generated/server'

/**
 * Memory Archival & Cleanup Workers
 *
 * Manages the memory lifecycle beyond decay scoring:
 *   1. Archive — mark decayed memories (score 0.1–0.3) as archived
 *   2. Compress — LLM-summarize groups of archived memories into one
 *   3. Purge — soft-delete expired memories, hard-delete after 90d grace
 *   4. Orphan cleanup — remove dangling memoryRelations
 */

const ARCHIVE_THRESHOLD = 0.3
const EXPIRE_THRESHOLD = 0.1
const HARD_DELETE_GRACE_MS = 90 * 86_400_000
const MAX_ARCHIVE_BATCH = 100
const MAX_PURGE_BATCH = 100
const MAX_COMPRESS_GROUPS = 10
const MIN_GROUP_SIZE_FOR_COMPRESSION = 3
const MAX_ORPHAN_CLEANUP = 50
const TTL_MS_PER_DAY = 86_400_000
const TTL_DAYS: Record<string, number | null> = {
  fact: 180,
  preference: 90,
  instruction: null,
  context: 30,
  relationship: 180,
  episodic: 90,
}

function computeTTLExpiresAt(type: string, createdAt: number): number | undefined {
  const days = TTL_DAYS[type]
  if (days === null || days === undefined) return undefined
  return createdAt + days * TTL_MS_PER_DAY
}

const LLM_PROVIDERS = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    envVar: 'OPENROUTER_API_KEY',
    model: 'openai/gpt-4o-mini',
    name: 'OpenRouter',
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    envVar: 'OPENAI_API_KEY',
    model: 'gpt-4o-mini',
    name: 'OpenAI',
  },
} as const

type LLMProviderKey = keyof typeof LLM_PROVIDERS

interface ResolvedLLMProvider {
  url: string
  apiKey: string
  model: string
  name: string
}

function resolveLLMProvider(): ResolvedLLMProvider | null {
  const order: LLMProviderKey[] = ['openrouter', 'openai']

  for (const key of order) {
    const provider = LLM_PROVIDERS[key]
    const apiKey = process.env[provider.envVar]
    if (apiKey && apiKey.trim().length > 0) {
      return { url: provider.url, apiKey, model: provider.model, name: provider.name }
    }
  }

  return null
}

const retrier = new ActionRetrier(components.actionRetrier, {
  initialBackoffMs: 500,
  base: 2,
  maxFailures: 3,
})

/**
 * Fetch business memories in the archive decay range that are not yet archived.
 */
export const getArchiveCandidates = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args): Promise<Doc<'businessMemories'>[]> => {
    const all = await ctx.db
      .query('businessMemories')
      .withIndex('by_created')
      .order('desc')
      .take(args.limit * 5)

    return all
      .filter(
        (m) =>
          m.isActive &&
          !m.isArchived &&
          m.decayScore > EXPIRE_THRESHOLD &&
          m.decayScore <= ARCHIVE_THRESHOLD
      )
      .slice(0, args.limit)
  },
})

/**
 * Fetch archived memories grouped by subject for compression.
 */
export const getArchivedMemoriesBySubject = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    limit: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ subjectKey: string; memories: Doc<'businessMemories'>[] }[]> => {
    const archived = await ctx.db
      .query('businessMemories')
      .withIndex('by_org_active', (q) =>
        q.eq('organizationId', args.organizationId).eq('isActive', true)
      )
      .take(500)
      .then((results) => results.filter((m) => m.isArchived && m.subjectType && m.subjectId))

    const groups = new Map<string, Doc<'businessMemories'>[]>()
    for (const memory of archived) {
      const key = `${memory.subjectType}:${memory.subjectId}`
      const existing = groups.get(key) ?? []
      existing.push(memory)
      groups.set(key, existing)
    }

    return Array.from(groups.entries())
      .filter(([_, memories]) => memories.length >= MIN_GROUP_SIZE_FOR_COMPRESSION)
      .slice(0, args.limit)
      .map(([subjectKey, memories]) => ({ subjectKey, memories }))
  },
})

/**
 * Fetch memories eligible for soft-delete (decayScore < 0.1 or past TTL).
 */
export const getPurgeCandidates = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args): Promise<Doc<'businessMemories'>[]> => {
    const now = Date.now()
    const all = await ctx.db
      .query('businessMemories')
      .withIndex('by_created')
      .order('asc')
      .take(args.limit * 5)

    return all
      .filter(
        (m) =>
          m.isActive &&
          (m.decayScore <= EXPIRE_THRESHOLD || (m.expiresAt != null && m.expiresAt < now))
      )
      .slice(0, args.limit)
  },
})

/**
 * Fetch soft-deleted memories that have been inactive for 90+ days.
 */
export const getHardDeleteCandidates = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args): Promise<Doc<'businessMemories'>[]> => {
    const cutoff = Date.now() - HARD_DELETE_GRACE_MS
    const all = await ctx.db
      .query('businessMemories')
      .withIndex('by_created')
      .order('asc')
      .take(args.limit * 5)

    return all.filter((m) => !m.isActive && m.updatedAt < cutoff).slice(0, args.limit)
  },
})

/**
 * Find orphaned relations whose source or target memory document no longer exists or is inactive.
 * Only checks relations where sourceType/targetType === 'memory' (i.e. direct Convex doc references).
 * Relations from LLM extraction use entity names as IDs (sourceType: 'lead', 'service', etc.)
 * and are NOT checked here since they don't reference Convex document IDs.
 */
export const getOrphanedRelations = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args): Promise<Id<'memoryRelations'>[]> => {
    const relations = await ctx.db.query('memoryRelations').take(args.limit * 3)
    const orphaned: Id<'memoryRelations'>[] = []

    for (const rel of relations) {
      if (orphaned.length >= args.limit) break

      if (rel.sourceType === 'memory') {
        try {
          const source = await ctx.db.get(rel.sourceId as Id<'businessMemories'>)
          if (!source || !source.isActive) {
            orphaned.push(rel._id)
            continue
          }
        } catch {
          orphaned.push(rel._id)
          continue
        }
      }
      if (rel.targetType === 'memory') {
        try {
          const target = await ctx.db.get(rel.targetId as Id<'businessMemories'>)
          if (!target || !target.isActive) {
            orphaned.push(rel._id)
          }
        } catch {
          orphaned.push(rel._id)
        }
      }
    }

    return orphaned
  },
})

export const markBatchArchived = internalMutation({
  args: {
    memoryIds: v.array(v.id('businessMemories')),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    let archived = 0

    for (const id of args.memoryIds) {
      const memory = await ctx.db.get(id)
      if (memory?.isActive && !memory.isArchived) {
        await ctx.db.patch(id, { isArchived: true, updatedAt: now })
        archived++
      }
    }

    return { archived }
  },
})

export const softDeleteBatch = internalMutation({
  args: {
    memoryIds: v.array(v.id('businessMemories')),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    let deleted = 0

    for (const id of args.memoryIds) {
      const memory = await ctx.db.get(id)
      if (memory?.isActive) {
        await ctx.db.patch(id, { isActive: false, updatedAt: now })
        deleted++
      }
    }

    return { deleted }
  },
})

export const hardDeleteBatch = internalMutation({
  args: {
    memoryIds: v.array(v.id('businessMemories')),
  },
  handler: async (ctx, args) => {
    let deleted = 0

    for (const id of args.memoryIds) {
      const memory = await ctx.db.get(id)
      if (memory && !memory.isActive) {
        await ctx.db.delete(id)
        deleted++
      }
    }

    return { deleted }
  },
})

export const deleteOrphanedRelations = internalMutation({
  args: {
    relationIds: v.array(v.id('memoryRelations')),
  },
  handler: async (ctx, args) => {
    let deleted = 0

    for (const id of args.relationIds) {
      const rel = await ctx.db.get(id)
      if (rel) {
        await ctx.db.delete(id)
        deleted++
      }
    }

    return { deleted }
  },
})

export const insertConsolidatedMemory = internalMutation({
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
    subjectType: v.optional(v.string()),
    subjectId: v.optional(v.string()),
    importance: v.float64(),
    confidence: v.float64(),
    sourceIds: v.array(v.id('businessMemories')),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const { sourceIds, ...memoryData } = args

    const id = await ctx.db.insert('businessMemories', {
      ...memoryData,
      decayScore: 0.5,
      accessCount: 0,
      lastAccessedAt: now,
      source: 'system' as const,
      expiresAt: computeTTLExpiresAt(args.type, now),
      isActive: true,
      isArchived: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })

    for (const sourceId of sourceIds) {
      const memory = await ctx.db.get(sourceId)
      if (memory?.isActive) {
        await ctx.db.patch(sourceId, { isActive: false, updatedAt: now })
      }
    }

    await ctx.scheduler.runAfter(0, internal.embedding.generateAndStore, {
      tableName: 'businessMemories' as const,
      documentId: id,
      content: args.content,
    })

    return id
  },
})

/**
 * Mark decayed memories (0.1 < score <= 0.3) as archived. Runs daily.
 */
export const archiveDecayedMemories = internalAction({
  args: {},
  handler: async (ctx): Promise<{ archived: number }> => {
    const candidates: Doc<'businessMemories'>[] = await ctx.runQuery(
      internal.memoryArchival.getArchiveCandidates,
      { limit: MAX_ARCHIVE_BATCH }
    )

    if (candidates.length === 0) return { archived: 0 }

    const ids = candidates.map((m) => m._id)
    const result = await ctx.runMutation(internal.memoryArchival.markBatchArchived, {
      memoryIds: ids,
    })

    if (result.archived > 0) {
      console.log(`[Archival] Archived ${result.archived} decayed memories`)
    }

    return result
  },
})

async function callCompressionLLM(
  provider: ResolvedLLMProvider,
  memoryContents: string[]
): Promise<string> {
  const prompt = `Summarize the following related memories into a single concise memory entry.
Preserve the most important facts, preferences, and context.
The summary must be self-contained (understandable without the originals).
Keep it between 50-200 characters.

Memories to consolidate:
${memoryContents.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Respond with ONLY the summary text, nothing else.`

  const response = await fetch(provider.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.3,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`LLM compression call failed (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content || content.length < 10) {
    throw new Error('LLM returned empty or too-short compression result')
  }

  return content
}

/**
 * LLM-powered compression of archived memory groups. Uses action-retrier.
 */
export const compressMemoryGroup = internalAction({
  args: {
    organizationId: v.id('organizations'),
    memoryIds: v.array(v.id('businessMemories')),
    memoryContents: v.array(v.string()),
    subjectType: v.optional(v.string()),
    subjectId: v.optional(v.string()),
    dominantType: v.string(),
    avgImportance: v.float64(),
    avgConfidence: v.float64(),
  },
  handler: async (ctx, args) => {
    const provider = resolveLLMProvider()
    if (!provider) {
      console.warn('[Archival] Skipping compression — no LLM provider configured')
      return
    }

    const summary = await callCompressionLLM(provider, args.memoryContents)

    const validType = [
      'fact',
      'preference',
      'instruction',
      'context',
      'relationship',
      'episodic',
    ].includes(args.dominantType)
      ? args.dominantType
      : 'fact'

    await ctx.runMutation(internal.memoryArchival.insertConsolidatedMemory, {
      organizationId: args.organizationId,
      type: validType as
        | 'fact'
        | 'preference'
        | 'instruction'
        | 'context'
        | 'relationship'
        | 'episodic',
      content: summary,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      importance: args.avgImportance,
      confidence: Math.min(args.avgConfidence, 0.85),
      sourceIds: args.memoryIds,
    })
  },
})

/**
 * Find and compress groups of archived memories. Runs daily after archival.
 */
export const compressArchivedMemories = internalAction({
  args: {},
  handler: async (ctx): Promise<{ groupsCompressed: number }> => {
    const provider = resolveLLMProvider()
    if (!provider) {
      console.warn('[Archival] Skipping compression — no LLM provider configured')
      return { groupsCompressed: 0 }
    }

    const orgIds: Id<'organizations'>[] = await ctx.runQuery(
      internal.memoryDecay.getOrgsWithActiveMemories
    )

    let groupsCompressed = 0

    for (const orgId of orgIds) {
      if (groupsCompressed >= MAX_COMPRESS_GROUPS) break

      const groups: Array<{ subjectKey: string; memories: Doc<'businessMemories'>[] }> =
        await ctx.runQuery(internal.memoryArchival.getArchivedMemoriesBySubject, {
          organizationId: orgId,
          limit: MAX_COMPRESS_GROUPS - groupsCompressed,
        })

      for (const group of groups) {
        const typeCounts = new Map<string, number>()
        let totalImportance = 0
        let totalConfidence = 0

        for (const m of group.memories) {
          typeCounts.set(m.type, (typeCounts.get(m.type) ?? 0) + 1)
          totalImportance += m.importance
          totalConfidence += m.confidence
        }

        let dominantType = 'fact'
        let maxCount = 0
        for (const [type, count] of typeCounts) {
          if (count > maxCount) {
            dominantType = type
            maxCount = count
          }
        }

        const [subjectType, subjectId] = group.subjectKey.split(':')

        await retrier.run(ctx, internal.memoryArchival.compressMemoryGroup, {
          organizationId: orgId,
          memoryIds: group.memories.map((m) => m._id),
          memoryContents: group.memories.map((m) => m.content),
          subjectType,
          subjectId,
          dominantType,
          avgImportance: totalImportance / group.memories.length,
          avgConfidence: totalConfidence / group.memories.length,
        })

        groupsCompressed++
      }
    }

    if (groupsCompressed > 0) {
      console.log(`[Archival] Compressed ${groupsCompressed} memory groups`)
    }

    return { groupsCompressed }
  },
})

/**
 * Soft-delete expired memories and hard-delete old soft-deleted ones.
 * Runs weekly.
 */
export const purgeExpiredMemories = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{ softDeleted: number; hardDeleted: number; orphansRemoved: number }> => {
    const purgeCandidates: Doc<'businessMemories'>[] = await ctx.runQuery(
      internal.memoryArchival.getPurgeCandidates,
      { limit: MAX_PURGE_BATCH }
    )

    let softDeleted = 0
    if (purgeCandidates.length > 0) {
      const result = await ctx.runMutation(internal.memoryArchival.softDeleteBatch, {
        memoryIds: purgeCandidates.map((m) => m._id),
      })
      softDeleted = result.deleted
    }

    const hardDeleteCandidates: Doc<'businessMemories'>[] = await ctx.runQuery(
      internal.memoryArchival.getHardDeleteCandidates,
      { limit: MAX_PURGE_BATCH }
    )

    let hardDeleted = 0
    if (hardDeleteCandidates.length > 0) {
      const result = await ctx.runMutation(internal.memoryArchival.hardDeleteBatch, {
        memoryIds: hardDeleteCandidates.map((m) => m._id),
      })
      hardDeleted = result.deleted
    }

    const orphanIds: Id<'memoryRelations'>[] = await ctx.runQuery(
      internal.memoryArchival.getOrphanedRelations,
      { limit: MAX_ORPHAN_CLEANUP }
    )

    let orphansRemoved = 0
    if (orphanIds.length > 0) {
      const result = await ctx.runMutation(internal.memoryArchival.deleteOrphanedRelations, {
        relationIds: orphanIds,
      })
      orphansRemoved = result.deleted
    }

    if (softDeleted > 0 || hardDeleted > 0 || orphansRemoved > 0) {
      console.log(
        `[Purge] Soft-deleted: ${softDeleted}, Hard-deleted: ${hardDeleted}, Orphans removed: ${orphansRemoved}`
      )
    }

    return { softDeleted, hardDeleted, orphansRemoved }
  },
})

/**
 * Lightweight lifecycle sanity checks for archival pipelines.
 * Runs on a schedule to surface growing queues/backlogs early.
 */
export const lifecycleHealthCheck = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    archiveCandidates: number
    purgeCandidates: number
    hardDeleteCandidates: number
    orphanedRelations: number
    checkedAt: number
  }> => {
    const [archiveCandidates, purgeCandidates, hardDeleteCandidates, orphanedRelations] =
      await Promise.all([
        ctx.runQuery(internal.memoryArchival.getArchiveCandidates, { limit: MAX_ARCHIVE_BATCH }),
        ctx.runQuery(internal.memoryArchival.getPurgeCandidates, { limit: MAX_PURGE_BATCH }),
        ctx.runQuery(internal.memoryArchival.getHardDeleteCandidates, { limit: MAX_PURGE_BATCH }),
        ctx.runQuery(internal.memoryArchival.getOrphanedRelations, { limit: MAX_ORPHAN_CLEANUP }),
      ])

    const result = {
      archiveCandidates: archiveCandidates.length,
      purgeCandidates: purgeCandidates.length,
      hardDeleteCandidates: hardDeleteCandidates.length,
      orphanedRelations: orphanedRelations.length,
      checkedAt: Date.now(),
    }

    if (
      result.archiveCandidates >= MAX_ARCHIVE_BATCH ||
      result.purgeCandidates >= MAX_PURGE_BATCH ||
      result.hardDeleteCandidates >= MAX_PURGE_BATCH
    ) {
      console.warn('[Lifecycle] Potential backlog detected:', result)
    } else if (
      result.archiveCandidates > 0 ||
      result.purgeCandidates > 0 ||
      result.hardDeleteCandidates > 0 ||
      result.orphanedRelations > 0
    ) {
      console.log('[Lifecycle] Health check:', result)
    }

    return result
  },
})

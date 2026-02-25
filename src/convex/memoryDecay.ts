import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from './_generated/server'

/**
 * Memory Decay Workers
 *
 * Recalculates decayScore for all active memories using the Ebbinghaus formula:
 *   strength = e^(-lambda * t / (1 + r))
 *
 * Runs hourly via cron. Also provides a real-time boost function
 * called after memory access to avoid waiting for the next cron cycle.
 */

const MS_PER_DAY = 86_400_000

const DECAY_RATES: Record<string, number> = {
  instruction: 0.01,
  fact: 0.05,
  preference: 0.08,
  pattern: 0.1,
  context: 0.15,
  relationship: 0.08,
  episodic: 0.2,
}

const REINFORCEMENT_ACCESS_BOOST = 0.1
const REINFORCEMENT_SUCCESS_BOOST = 0.2
const LIFECYCLE_ARCHIVE = 0.3
const LIFECYCLE_EXPIRED = 0.1

const BATCH_SIZE = 100

function getBaseDecayRate(memoryType: string): number {
  return DECAY_RATES[memoryType] ?? 0.1
}

function computeReinforcement(accessCount: number, successRate: number): number {
  const r = accessCount * REINFORCEMENT_ACCESS_BOOST + successRate * REINFORCEMENT_SUCCESS_BOOST
  return Math.max(0, r)
}

function calculateDecayStrength(
  memoryType: string,
  timeSinceAccessMs: number,
  reinforcement: number
): number {
  if (!Number.isFinite(timeSinceAccessMs) || timeSinceAccessMs <= 0) return 1.0
  if (!Number.isFinite(reinforcement)) reinforcement = 0

  const lambda = getBaseDecayRate(memoryType)
  const tDays = timeSinceAccessMs / MS_PER_DAY
  const safeR = Math.max(0, reinforcement)

  const strength = Math.exp((-lambda * tDays) / (1 + safeR))
  if (!Number.isFinite(strength)) return 0
  return Math.max(0, Math.min(1, strength))
}

/**
 * Paginated fetch of active business memories for a given org.
 */
export const getActiveBusinessBatch = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<Doc<'businessMemories'>[]> => {
    return ctx.db
      .query('businessMemories')
      .withIndex('by_org_active', (q) =>
        q.eq('organizationId', args.organizationId).eq('isActive', true)
      )
      .take(args.limit)
  },
})

/**
 * Paginated fetch of active agent memories for a given org.
 */
export const getActiveAgentBatch = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<Doc<'agentMemories'>[]> => {
    return ctx.db
      .query('agentMemories')
      .withIndex('by_org_agent_active', (q) => q.eq('organizationId', args.organizationId))
      .take(args.limit * 3)
      .then((results) => results.filter((m) => m.isActive).slice(0, args.limit))
  },
})

/**
 * Get all distinct organization IDs that have active business memories.
 * Scans the businessMemories table using by_org_active index to find only
 * orgs that actually have work to do, avoiding a full organizations table scan.
 */
export const getOrgsWithActiveMemories = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<'organizations'>[]> => {
    // Pull a generous batch of active memories; dedup org IDs in-process.
    // This avoids scanning the organizations table (which may contain orgs with no memories).
    const memories = await ctx.db
      .query('businessMemories')
      .withIndex('by_created')
      .order('desc')
      .take(5000)

    const orgIds = new Set<Id<'organizations'>>()
    for (const m of memories) {
      if (m.isActive) orgIds.add(m.organizationId)
    }

    return Array.from(orgIds)
  },
})

/**
 * Recalculate decay scores for a batch of business memories.
 * Runs inside a single transaction (Convex mutation).
 */
export const updateBusinessDecayBatch = internalMutation({
  args: {
    memoryIds: v.array(v.id('businessMemories')),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    let updated = 0
    let transitioned = 0

    for (const id of args.memoryIds) {
      const memory = await ctx.db.get(id)
      if (!memory || !memory.isActive) continue

      const timeSinceAccess = now - memory.lastAccessedAt
      // successRate is intentionally 0 for business memories: they don't have an
      // outcome-based success metric (unlike agent memories which track successRate).
      // Access frequency alone (accessCount) drives reinforcement for business memories.
      const reinforcement = computeReinforcement(memory.accessCount, 0)
      const newScore = calculateDecayStrength(memory.type, timeSinceAccess, reinforcement)

      if (Math.abs(newScore - memory.decayScore) > 0.001) {
        const patch: Record<string, any> = {
          decayScore: newScore,
          updatedAt: now,
        }

        if (newScore <= LIFECYCLE_EXPIRED && memory.isActive) {
          patch.isActive = false
          transitioned++
        } else if (newScore <= LIFECYCLE_ARCHIVE && !memory.isArchived) {
          patch.isArchived = true
          transitioned++
        }

        await ctx.db.patch(id, patch)
        updated++
      }
    }

    return { updated, transitioned }
  },
})

/**
 * Recalculate decay scores for a batch of agent memories.
 */
export const updateAgentDecayBatch = internalMutation({
  args: {
    memoryIds: v.array(v.id('agentMemories')),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    let updated = 0
    let transitioned = 0

    for (const id of args.memoryIds) {
      const memory = await ctx.db.get(id)
      if (!memory || !memory.isActive) continue

      const timeSinceUse = now - memory.lastUsedAt
      const reinforcement = computeReinforcement(memory.useCount, memory.successRate)
      const newScore = calculateDecayStrength('pattern', timeSinceUse, reinforcement)

      if (Math.abs(newScore - memory.decayScore) > 0.001) {
        const patch: Record<string, any> = {
          decayScore: newScore,
          updatedAt: now,
        }

        if (newScore <= LIFECYCLE_EXPIRED) {
          patch.isActive = false
          transitioned++
        }

        await ctx.db.patch(id, patch)
        updated++
      }
    }

    return { updated, transitioned }
  },
})

/**
 * Main decay update orchestrator. Called by hourly cron.
 * Iterates all orgs, processes business and agent memories in batches.
 */
export const runDecayUpdate = internalAction({
  args: {},
  handler: async (ctx): Promise<{ totalUpdated: number; totalTransitioned: number }> => {
    const orgIds: Id<'organizations'>[] = await ctx.runQuery(
      internal.memoryDecay.getOrgsWithActiveMemories
    )

    let totalUpdated = 0
    let totalTransitioned = 0

    for (const orgId of orgIds) {
      const businessMemories: Doc<'businessMemories'>[] = await ctx.runQuery(
        internal.memoryDecay.getActiveBusinessBatch,
        { organizationId: orgId, limit: BATCH_SIZE }
      )

      if (businessMemories.length > 0) {
        const ids = businessMemories.map((m) => m._id)
        const result = await ctx.runMutation(internal.memoryDecay.updateBusinessDecayBatch, {
          memoryIds: ids,
        })
        totalUpdated += result.updated
        totalTransitioned += result.transitioned
      }

      const agentMemories: Doc<'agentMemories'>[] = await ctx.runQuery(
        internal.memoryDecay.getActiveAgentBatch,
        { organizationId: orgId, limit: BATCH_SIZE }
      )

      if (agentMemories.length > 0) {
        const ids = agentMemories.map((m) => m._id)
        const result = await ctx.runMutation(internal.memoryDecay.updateAgentDecayBatch, {
          memoryIds: ids,
        })
        totalUpdated += result.updated
        totalTransitioned += result.transitioned
      }
    }

    if (totalUpdated > 0 || totalTransitioned > 0) {
      console.log(
        `[Decay] Updated ${totalUpdated} memories, ${totalTransitioned} lifecycle transitions across ${orgIds.length} orgs`
      )
    }

    return { totalUpdated, totalTransitioned }
  },
})

/**
 * Immediately recalculate and boost decayScore after a memory is accessed.
 * Called by recordAccess/recordUse via scheduler — non-blocking.
 */
export const boostBusinessDecayOnAccess = internalMutation({
  args: {
    id: v.id('businessMemories'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.id)
    if (!memory || memory.organizationId !== args.organizationId || !memory.isActive) return

    const reinforcement = computeReinforcement(memory.accessCount, 0)
    const timeSinceAccess = Date.now() - memory.lastAccessedAt
    let newScore = calculateDecayStrength(memory.type, timeSinceAccess, reinforcement)
    newScore = Math.min(1.0, Math.max(newScore, memory.decayScore))

    if (newScore !== memory.decayScore) {
      await ctx.db.patch(args.id, {
        decayScore: newScore,
        isArchived: newScore > LIFECYCLE_ARCHIVE ? false : memory.isArchived,
        updatedAt: Date.now(),
      })
    }
  },
})

export const boostAgentDecayOnAccess = internalMutation({
  args: {
    id: v.id('agentMemories'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.id)
    if (!memory || memory.organizationId !== args.organizationId || !memory.isActive) return

    const reinforcement = computeReinforcement(memory.useCount, memory.successRate)
    const timeSinceUse = Date.now() - memory.lastUsedAt
    let newScore = calculateDecayStrength('pattern', timeSinceUse, reinforcement)
    newScore = Math.min(1.0, Math.max(newScore, memory.decayScore))

    if (newScore !== memory.decayScore) {
      await ctx.db.patch(args.id, {
        decayScore: newScore,
        updatedAt: Date.now(),
      })
    }
  },
})

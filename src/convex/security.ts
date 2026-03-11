import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation } from './_generated/server'

const DEV_MODE = process.env.NODE_ENV !== 'production'
const DEBUG = process.env.DEBUG_MEMORY === 'true' || DEV_MODE

/**
 * Enforce a shared server token for public Convex memory surfaces.
 *
 * In production, MEMORY_API_TOKEN must be configured and provided by trusted
 * server callers (e.g. Next.js API route). In local dev/test, auth is bypassed
 * only when DISABLE_AUTH_IN_DEV=true and MEMORY_API_TOKEN is not set.
 */
export function assertMemoryApiToken(argsToken: string | undefined, surface: string): void {
  const requiredToken = process.env.MEMORY_API_TOKEN
  const allowDevBypass = process.env.DISABLE_AUTH_IN_DEV === 'true'

  if (!requiredToken || requiredToken.trim().length === 0) {
    if (!DEV_MODE) {
      throw new ConvexError({
        code: 'CONFIGURATION_ERROR',
        message: 'MEMORY_API_TOKEN is required in production.',
      })
    }

    if (!allowDevBypass) {
      throw new ConvexError({
        code: 'CONFIGURATION_ERROR',
        message: 'MEMORY_API_TOKEN is required unless DISABLE_AUTH_IN_DEV=true in non-production.',
      })
    }

    if (DEBUG) {
      console.warn(
        '[Memory:Security] MEMORY_API_TOKEN not set; allowing unsecured dev access because DISABLE_AUTH_IN_DEV=true',
        {
          surface,
        }
      )
    }
    return
  }

  if (argsToken !== requiredToken) {
    throw new ConvexError({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized memory API access.',
    })
  }
}

export const consumeRateLimit = mutation({
  args: {
    authToken: v.optional(v.string()),
    scope: v.union(v.literal('chat_request'), v.literal('approval_review')),
    key: v.string(),
    maxRequests: v.number(),
    windowMs: v.number(),
    organizationId: v.optional(v.id('organizations')),
    userId: v.optional(v.id('appUsers')),
    ipAddress: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  returns: v.object({
    scope: v.union(v.literal('chat_request'), v.literal('approval_review')),
    key: v.string(),
    allowed: v.boolean(),
    limit: v.number(),
    remaining: v.number(),
    resetAt: v.number(),
    retryAfterSeconds: v.number(),
  }),
  handler: async (ctx, args) => {
    assertMemoryApiToken(args.authToken, 'security.consumeRateLimit')

    if (args.maxRequests <= 0 || args.windowMs <= 0) {
      throw new ConvexError({
        code: 'INVALID_RATE_LIMIT_CONFIG',
        message: 'maxRequests and windowMs must be positive numbers.',
      })
    }

    const now = args.nowMs ?? Date.now()
    const retryAfterFromReset = (resetAt: number) =>
      Math.max(1, Math.ceil(Math.max(0, resetAt - now) / 1000))

    const rows = await ctx.db
      .query('securityRateLimits')
      .withIndex('by_key', (q) => q.eq('key', args.key))
      .take(5)

    const active = rows.find((row) => row.resetAt > now) ?? null

    if (!active) {
      const resetAt = now + args.windowMs
      const newestExpired = rows
        .filter((row) => row.resetAt <= now)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]

      if (newestExpired) {
        await ctx.db.patch(newestExpired._id, {
          scope: args.scope,
          organizationId: args.organizationId,
          userId: args.userId,
          ipAddress: args.ipAddress,
          count: 1,
          resetAt,
          updatedAt: now,
        })

        for (const row of rows) {
          if (row._id !== newestExpired._id) {
            await ctx.db.delete(row._id)
          }
        }
      } else {
        await ctx.db.insert('securityRateLimits', {
          key: args.key,
          scope: args.scope,
          organizationId: args.organizationId,
          userId: args.userId,
          ipAddress: args.ipAddress,
          count: 1,
          resetAt,
          createdAt: now,
          updatedAt: now,
        })
      }

      return {
        scope: args.scope,
        key: args.key,
        allowed: true,
        limit: args.maxRequests,
        remaining: Math.max(0, args.maxRequests - 1),
        resetAt,
        retryAfterSeconds: retryAfterFromReset(resetAt),
      }
    }

    const duplicateRows = rows.filter((row) => row._id !== active._id)
    if (duplicateRows.length > 0) {
      for (const row of duplicateRows) {
        if (row.resetAt <= now) {
          await ctx.db.delete(row._id)
        }
      }
    }

    if (active.count < args.maxRequests) {
      const nextCount = active.count + 1
      await ctx.db.patch(active._id, {
        count: nextCount,
        updatedAt: now,
      })

      return {
        scope: args.scope,
        key: args.key,
        allowed: true,
        limit: args.maxRequests,
        remaining: Math.max(0, args.maxRequests - nextCount),
        resetAt: active.resetAt,
        retryAfterSeconds: retryAfterFromReset(active.resetAt),
      }
    }

    return {
      scope: args.scope,
      key: args.key,
      allowed: false,
      limit: args.maxRequests,
      remaining: 0,
      resetAt: active.resetAt,
      retryAfterSeconds: retryAfterFromReset(active.resetAt),
    }
  },
})

const RATE_LIMIT_PURGE_BATCH_SIZE = 500

export const purgeExpiredRateLimits = internalMutation({
  args: {
    nowMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = args.nowMs ?? Date.now()
    const limit = Math.min(Math.max(args.limit ?? RATE_LIMIT_PURGE_BATCH_SIZE, 1), 2000)

    const expired = await ctx.db
      .query('securityRateLimits')
      .withIndex('by_reset', (q) => q.lt('resetAt', now))
      .take(limit)

    for (const row of expired) {
      await ctx.db.delete(row._id)
    }

    return { deleted: expired.length }
  },
})

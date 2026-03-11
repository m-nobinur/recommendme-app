import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { authComponent } from './auth'
import { assertUserInOrganization } from './lib/auth'
import { approvalStatusValues, boundedPageSize, riskLevelValues } from './lib/validators'

const reviewDecisionValues = v.union(v.literal('approve'), v.literal('reject'))

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const APPROVAL_EXECUTION_CLAIM_LEASE_MS = 2 * 60 * 1000
const APPROVED_EXECUTION_MAX_RETRIES = 3
const APPROVED_EXECUTION_RETRY_DELAYS_MS = [30_000, 120_000, 300_000] as const

const APPROVAL_TTL_MS: Record<'low' | 'medium' | 'high' | 'critical', number> = {
  low: 24 * 60 * 60 * 1000,
  medium: 24 * 60 * 60 * 1000,
  high: 4 * 60 * 60 * 1000,
  critical: 60 * 60 * 1000,
}

function hasValidServerBypassToken(token: string | undefined): boolean {
  if (!token) return false
  const normalized = token.trim()
  if (normalized.length === 0) return false

  const configured = process.env.MEMORY_API_TOKEN?.trim()
  if (configured && configured.length > 0) {
    return normalized === configured
  }

  // Local development fallback: Convex env vars may not mirror Next env vars.
  // Require a non-trivial token so accidental empty/short values are rejected.
  return normalized.length >= 24
}

function assertCanReviewQueue(user: Doc<'appUsers'>) {
  if (user.role !== 'owner' && user.role !== 'admin') {
    throw new Error('Only organization owners/admins can review approval queue items')
  }
}

async function appendDecisionAuditLog(
  ctx: {
    db: {
      insert: (...args: any[]) => Promise<unknown>
    }
  },
  args: {
    organizationId: Doc<'approvalQueue'>['organizationId']
    userId?: Doc<'appUsers'>['_id']
    actorType?: 'user' | 'system'
    approvalId: Doc<'approvalQueue'>['_id']
    executionId?: Doc<'approvalQueue'>['executionId']
    riskLevel: Doc<'approvalQueue'>['riskLevel']
    decision: 'approved' | 'rejected' | 'expired'
    rejectionReason?: string
    now: number
  }
) {
  await ctx.db.insert('auditLogs', {
    organizationId: args.organizationId,
    userId: args.userId,
    actorType: args.actorType ?? 'user',
    action:
      args.decision === 'approved'
        ? 'approval_review_approved'
        : args.decision === 'rejected'
          ? 'approval_review_rejected'
          : 'approval_review_expired',
    resourceType: 'approvalQueue',
    resourceId: String(args.approvalId),
    details: {
      decision: args.decision,
      executionId: args.executionId ? String(args.executionId) : undefined,
      rejectionReason: args.rejectionReason,
    },
    riskLevel: args.riskLevel,
    createdAt: args.now,
  })
}

async function resolveApprovalCaller(
  ctx: {
    db: {
      query: (tableName: 'appUsers') => {
        withIndex: (
          indexName: 'by_auth_user',
          indexBuilder: (q: { eq: (field: 'authUserId', value: string) => unknown }) => unknown
        ) => {
          first: () => Promise<Doc<'appUsers'> | null>
        }
      }
      get: (id: Id<'appUsers'>) => Promise<Doc<'appUsers'> | null>
    }
  },
  args: {
    userId: Id<'appUsers'>
    organizationId: Id<'organizations'>
    authToken?: string
  }
): Promise<Doc<'appUsers'>> {
  let authUser: { _id: string } | null = null
  try {
    authUser = await authComponent.getAuthUser(ctx as never)
  } catch {
    authUser = null
  }
  if (authUser) {
    const authMappedUser = await ctx.db
      .query('appUsers')
      .withIndex('by_auth_user', (q) => q.eq('authUserId', authUser._id))
      .first()

    if (!authMappedUser) {
      throw new Error('Authenticated app user was not found')
    }
    if (
      authMappedUser._id !== args.userId ||
      authMappedUser.organizationId !== args.organizationId
    ) {
      throw new Error('Authenticated user does not match requested approval context')
    }

    return authMappedUser
  }

  const authBypassEnabled =
    process.env.NODE_ENV === 'test' ||
    (process.env.NODE_ENV !== 'production' && process.env.DISABLE_AUTH_IN_DEV === 'true')
  const tokenBypassEnabled =
    process.env.NODE_ENV !== 'production' && hasValidServerBypassToken(args.authToken)
  if (authBypassEnabled || tokenBypassEnabled) {
    return await assertUserInOrganization(ctx as never, args.userId, args.organizationId)
  }

  throw new Error('Unauthenticated access to approval queue is not allowed')
}

export const listPending = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    authToken: v.optional(v.string()),
    now: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await resolveApprovalCaller(ctx as never, {
      userId: args.userId,
      organizationId: args.organizationId,
      authToken: args.authToken,
    })
    const canReview = user.role === 'owner' || user.role === 'admin'
    const pageSize = boundedPageSize(args.limit, DEFAULT_LIMIT, MAX_LIMIT)

    const rows = await ctx.db
      .query('approvalQueue')
      .withIndex('by_org_status_expires', (q) =>
        q
          .eq('organizationId', user.organizationId)
          .eq('status', 'pending')
          .gt('expiresAt', args.now)
      )
      .take(pageSize)

    if (canReview) {
      return rows.map((row) => ({
        ...row,
        canReview: true,
      }))
    }

    return rows.map((row) => ({
      _id: row._id,
      riskLevel: row.riskLevel,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      status: row.status,
      canReview: false,
    }))
  },
})

export const listByStatus = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    authToken: v.optional(v.string()),
    status: approvalStatusValues,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await resolveApprovalCaller(ctx as never, {
      userId: args.userId,
      organizationId: args.organizationId,
      authToken: args.authToken,
    })
    const canReview = user.role === 'owner' || user.role === 'admin'
    const pageSize = boundedPageSize(args.limit, DEFAULT_LIMIT, MAX_LIMIT)

    const rows = await ctx.db
      .query('approvalQueue')
      .withIndex('by_org_status_created', (q) =>
        q.eq('organizationId', user.organizationId).eq('status', args.status)
      )
      .order('desc')
      .take(pageSize)

    if (canReview) {
      return rows.map((row) => ({
        ...row,
        canReview: true,
      }))
    }

    return rows.map((row) => ({
      _id: row._id,
      riskLevel: row.riskLevel,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      status: row.status,
      canReview: false,
    }))
  },
})

export const review = mutation({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    authToken: v.optional(v.string()),
    id: v.id('approvalQueue'),
    decision: reviewDecisionValues,
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await resolveApprovalCaller(ctx as never, {
      userId: args.userId,
      organizationId: args.organizationId,
      authToken: args.authToken,
    })
    assertCanReviewQueue(user)

    const existing = await ctx.db.get(args.id)
    if (!existing || existing.organizationId !== user.organizationId) {
      throw new Error('Approval item not found or access denied')
    }
    if (existing.status !== 'pending') {
      throw new Error(`Approval item is already ${existing.status}`)
    }

    const now = Date.now()
    if (existing.expiresAt <= now) {
      await ctx.db.patch(args.id, {
        status: 'expired',
        executionClaimedAt: undefined,
        executionProcessedAt: undefined,
        updatedAt: now,
      })
      await appendDecisionAuditLog(ctx, {
        organizationId: user.organizationId,
        userId: args.userId,
        approvalId: args.id,
        executionId: existing.executionId,
        riskLevel: existing.riskLevel,
        decision: 'expired',
        now,
      })
      if (existing.executionId) {
        await ctx.scheduler.runAfter(
          0,
          internal.agentRunner.reconcileExecutionAfterApprovalDecision,
          {
            executionId: existing.executionId,
          }
        )
      }
      return { status: 'expired' as const }
    }

    if (args.decision === 'approve') {
      await ctx.db.patch(args.id, {
        status: 'approved',
        reviewedBy: args.userId,
        reviewedAt: now,
        rejectionReason: undefined,
        executionClaimedAt: undefined,
        executionProcessedAt: undefined,
        executionRetryCount: 0,
        updatedAt: now,
      })
      await appendDecisionAuditLog(ctx, {
        organizationId: user.organizationId,
        userId: args.userId,
        approvalId: args.id,
        executionId: existing.executionId,
        riskLevel: existing.riskLevel,
        decision: 'approved',
        now,
      })
      await ctx.scheduler.runAfter(0, internal.agentRunner.executeApprovedQueueItem, {
        approvalId: args.id,
      })
      return { status: 'approved' as const }
    }

    await ctx.db.patch(args.id, {
      status: 'rejected',
      reviewedBy: args.userId,
      reviewedAt: now,
      rejectionReason: args.rejectionReason?.trim() || 'Rejected by reviewer',
      executionClaimedAt: undefined,
      executionProcessedAt: undefined,
      executionRetryCount: 0,
      updatedAt: now,
    })
    await appendDecisionAuditLog(ctx, {
      organizationId: user.organizationId,
      userId: args.userId,
      approvalId: args.id,
      executionId: existing.executionId,
      riskLevel: existing.riskLevel,
      decision: 'rejected',
      rejectionReason: args.rejectionReason?.trim() || 'Rejected by reviewer',
      now,
    })
    if (existing.executionId) {
      await ctx.scheduler.runAfter(
        0,
        internal.agentRunner.reconcileExecutionAfterApprovalDecision,
        {
          executionId: existing.executionId,
        }
      )
    }
    return { status: 'rejected' as const }
  },
})

export const enqueueBatch = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    executionId: v.optional(v.id('agentExecutions')),
    agentType: v.string(),
    context: v.optional(v.string()),
    actions: v.array(
      v.object({
        action: v.string(),
        target: v.optional(v.string()),
        actionParams: v.any(),
        riskLevel: riskLevelValues,
        description: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const ids: Doc<'approvalQueue'>['_id'][] = []

    for (const action of args.actions) {
      const ttlMs = APPROVAL_TTL_MS[action.riskLevel]
      const id = await ctx.db.insert('approvalQueue', {
        organizationId: args.organizationId,
        executionId: args.executionId,
        agentType: args.agentType,
        action: action.action,
        target: action.target,
        actionParams: action.actionParams,
        riskLevel: action.riskLevel,
        context: args.context,
        description: action.description,
        expiresAt: now + ttlMs,
        status: 'pending',
        executionClaimedAt: undefined,
        executionProcessedAt: undefined,
        executionRetryCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      ids.push(id)
    }

    return ids
  },
})

export const expireStalePending = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const pageSize = boundedPageSize(args.limit, DEFAULT_LIMIT, MAX_LIMIT)
    const now = Date.now()

    const staleRows = await ctx.db
      .query('approvalQueue')
      .withIndex('by_status_expires', (q) => q.eq('status', 'pending').lte('expiresAt', now))
      .take(pageSize)

    const affectedExecutionIds = new Set<Id<'agentExecutions'>>()
    for (const row of staleRows) {
      await ctx.db.patch(row._id, {
        status: 'expired',
        executionClaimedAt: undefined,
        executionProcessedAt: undefined,
        executionRetryCount: 0,
        updatedAt: now,
      })
      await appendDecisionAuditLog(ctx, {
        organizationId: row.organizationId,
        actorType: 'system',
        approvalId: row._id,
        executionId: row.executionId,
        riskLevel: row.riskLevel,
        decision: 'expired',
        now,
      })
      if (row.executionId) {
        affectedExecutionIds.add(row.executionId)
      }
    }

    for (const executionId of affectedExecutionIds) {
      await ctx.scheduler.runAfter(
        0,
        internal.agentRunner.reconcileExecutionAfterApprovalDecision,
        {
          executionId,
        }
      )
    }

    return { expiredCount: staleRows.length }
  },
})

export const markApprovedProcessed = internalMutation({
  args: {
    id: v.id('approvalQueue'),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (!row || row.status !== 'approved') {
      return { updated: false }
    }
    const processedAt = Math.max(Date.now(), (row.reviewedAt ?? row.updatedAt) + 1)
    await ctx.db.patch(args.id, {
      executionProcessedAt: processedAt,
      executionClaimedAt: undefined,
      updatedAt: processedAt,
    })
    return { updated: true }
  },
})

export const recordExecutionAttemptFailure = internalMutation({
  args: {
    id: v.id('approvalQueue'),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (!row || row.status !== 'approved') {
      return {
        shouldRetry: false,
        retryDelayMs: 0,
        retryCount: 0,
      }
    }

    const retryCount = (row.executionRetryCount ?? 0) + 1
    const shouldRetry = retryCount < APPROVED_EXECUTION_MAX_RETRIES
    const now = Date.now()

    await ctx.db.patch(args.id, {
      executionRetryCount: retryCount,
      executionClaimedAt: undefined,
      executionProcessedAt: shouldRetry ? undefined : now,
      updatedAt: now,
    })

    return {
      shouldRetry,
      retryDelayMs: shouldRetry
        ? APPROVED_EXECUTION_RETRY_DELAYS_MS[
            Math.min(retryCount - 1, APPROVED_EXECUTION_RETRY_DELAYS_MS.length - 1)
          ]
        : 0,
      retryCount,
    }
  },
})

export const claimApprovedForExecution = internalMutation({
  args: {
    id: v.id('approvalQueue'),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    const now = Date.now()
    if (!row || row.status !== 'approved') {
      return { claimed: false, reason: 'not_approved' as const }
    }
    const executionProcessedAt = (row as { executionProcessedAt?: number }).executionProcessedAt
    const executionClaimedAt = (row as { executionClaimedAt?: number }).executionClaimedAt
    if (typeof executionProcessedAt === 'number') {
      return { claimed: false, reason: 'already_processed' as const }
    }
    if (typeof executionClaimedAt === 'number') {
      const claimAgeMs = now - executionClaimedAt
      if (claimAgeMs <= APPROVAL_EXECUTION_CLAIM_LEASE_MS) {
        return { claimed: false, reason: 'already_claimed' as const }
      }
    }

    await ctx.db.patch(args.id, {
      executionClaimedAt: now,
      updatedAt: now,
    })
    return { claimed: true as const }
  },
})

export const listPendingByExecution = internalQuery({
  args: {
    executionId: v.id('agentExecutions'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('approvalQueue')
      .withIndex('by_execution', (q) => q.eq('executionId', args.executionId))
      .order('desc')
      .take(MAX_LIMIT)
  },
})

export const getById = internalQuery({
  args: {
    id: v.id('approvalQueue'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id)
  },
})

export const getStats = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    authToken: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await resolveApprovalCaller(ctx as never, {
      userId: args.userId,
      organizationId: args.organizationId,
      authToken: args.authToken,
    })

    const STATS_LIMIT = 500
    const rows = await ctx.db
      .query('approvalQueue')
      .withIndex('by_org_created', (q) => q.eq('organizationId', user.organizationId))
      .order('desc')
      .take(STATS_LIMIT)

    const counts = { pending: 0, approved: 0, rejected: 0, expired: 0 }
    for (const row of rows) {
      if (row.status === 'pending' && row.expiresAt <= args.now) {
        counts.expired++
      } else {
        counts[row.status]++
      }
    }

    return { total: rows.length, ...counts }
  },
})

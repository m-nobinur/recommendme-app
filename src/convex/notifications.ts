import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, mutation, query } from './_generated/server'
import { assertAuthenticatedUserInOrganization } from './lib/auth'
import { boundedPageSize } from './lib/validators'

export const notificationCategoryValues = v.union(
  v.literal('approval'),
  v.literal('agent'),
  v.literal('crm'),
  v.literal('memory'),
  v.literal('budget'),
  v.literal('communication'),
  v.literal('system')
)

export const notificationSeverityValues = v.union(
  v.literal('info'),
  v.literal('success'),
  v.literal('warning'),
  v.literal('error')
)

export type NotificationCategory =
  | 'approval'
  | 'agent'
  | 'crm'
  | 'memory'
  | 'budget'
  | 'communication'
  | 'system'

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const CLEANUP_BATCH_SIZE = 100
const NOTIFICATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export const create = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    userId: v.optional(v.id('appUsers')),
    category: notificationCategoryValues,
    severity: notificationSeverityValues,
    title: v.string(),
    body: v.optional(v.string()),
    actionUrl: v.optional(v.string()),
    actionLabel: v.optional(v.string()),
    referenceType: v.optional(v.string()),
    referenceId: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const id = await ctx.db.insert('notifications', {
      organizationId: args.organizationId,
      userId: args.userId,
      category: args.category,
      severity: args.severity,
      title: args.title,
      body: args.body,
      actionUrl: args.actionUrl,
      actionLabel: args.actionLabel,
      referenceType: args.referenceType,
      referenceId: args.referenceId,
      isRead: false,
      isDismissed: false,
      expiresAt: args.expiresAt,
      createdAt: now,
    })

    await ctx.scheduler.runAfter(0, internal.pushDispatch.sendPush, {
      organizationId: args.organizationId,
      userId: args.userId,
      title: args.title,
      body: args.body,
      actionUrl: args.actionUrl,
      category: args.category,
      severity: args.severity,
    })

    return id
  },
})

export const list = query({
  args: {
    organizationId: v.id('organizations'),
    category: v.optional(notificationCategoryValues),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const appUser = await assertAuthenticatedUserInOrganization(ctx, args.organizationId)
    const pageSize = boundedPageSize(args.limit, DEFAULT_LIMIT, MAX_LIMIT)
    const userId = appUser?._id

    const userRows = userId
      ? await ctx.db
          .query('notifications')
          .withIndex('by_org_user_created', (q) =>
            q.eq('organizationId', args.organizationId).eq('userId', userId)
          )
          .order('desc')
          .take(pageSize * 2)
      : await ctx.db
          .query('notifications')
          .withIndex('by_org_user_created', (q) => q.eq('organizationId', args.organizationId))
          .order('desc')
          .take(pageSize * 2)

    let filtered = userRows.filter((n) => !n.isDismissed)
    if (args.category) {
      filtered = filtered.filter((n) => n.category === args.category)
    }

    if (userId) {
      const orgWide = await ctx.db
        .query('notifications')
        .withIndex('by_org_user_created', (q) =>
          q.eq('organizationId', args.organizationId).eq('userId', undefined as any)
        )
        .order('desc')
        .take(pageSize)

      const orgWideFiltered = orgWide.filter((n) => {
        if (n.isDismissed) return false
        if (args.category && n.category !== args.category) return false
        return true
      })

      filtered = [...filtered, ...orgWideFiltered].sort((a, b) => b.createdAt - a.createdAt)
    }

    return filtered.slice(0, pageSize)
  },
})

export const getUnreadCount = query({
  args: {
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const appUser = await assertAuthenticatedUserInOrganization(ctx, args.organizationId)
    const userId = appUser?._id

    const userUnread = userId
      ? await ctx.db
          .query('notifications')
          .withIndex('by_org_user_read_created', (q) =>
            q.eq('organizationId', args.organizationId).eq('userId', userId).eq('isRead', false)
          )
          .take(100)
      : await ctx.db
          .query('notifications')
          .withIndex('by_org_user_read_created', (q) => q.eq('organizationId', args.organizationId))
          .filter((q) => q.eq(q.field('isRead'), false))
          .take(100)

    let count = userUnread.filter((n) => !n.isDismissed).length

    if (userId) {
      const orgWideUnread = await ctx.db
        .query('notifications')
        .withIndex('by_org_user_read_created', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('userId', undefined as any)
            .eq('isRead', false)
        )
        .take(100)

      count += orgWideUnread.filter((n) => !n.isDismissed).length
    }

    return { count }
  },
})

export const markRead = mutation({
  args: {
    organizationId: v.id('organizations'),
    notificationId: v.id('notifications'),
  },
  handler: async (ctx, args) => {
    await assertAuthenticatedUserInOrganization(ctx, args.organizationId)

    const notification = await ctx.db.get(args.notificationId)
    if (!notification || notification.organizationId !== args.organizationId) {
      return { updated: false }
    }
    if (notification.isRead) {
      return { updated: false }
    }

    await ctx.db.patch(args.notificationId, {
      isRead: true,
      readAt: Date.now(),
    })
    return { updated: true }
  },
})

export const markAllRead = mutation({
  args: {
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const appUser = await assertAuthenticatedUserInOrganization(ctx, args.organizationId)
    const userId = appUser?._id

    const unread = userId
      ? await ctx.db
          .query('notifications')
          .withIndex('by_org_user_read_created', (q) =>
            q.eq('organizationId', args.organizationId).eq('userId', userId).eq('isRead', false)
          )
          .take(MAX_LIMIT)
      : await ctx.db
          .query('notifications')
          .withIndex('by_org_user_read_created', (q) => q.eq('organizationId', args.organizationId))
          .filter((q) => q.eq(q.field('isRead'), false))
          .take(MAX_LIMIT)

    const now = Date.now()
    let marked = 0
    for (const notification of unread) {
      if (!notification.isDismissed) {
        await ctx.db.patch(notification._id, { isRead: true, readAt: now })
        marked++
      }
    }

    if (userId) {
      const orgWideUnread = await ctx.db
        .query('notifications')
        .withIndex('by_org_user_read_created', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('userId', undefined as any)
            .eq('isRead', false)
        )
        .take(MAX_LIMIT)

      for (const notification of orgWideUnread) {
        if (!notification.isDismissed) {
          await ctx.db.patch(notification._id, { isRead: true, readAt: now })
          marked++
        }
      }
    }

    return { marked }
  },
})

export const dismiss = mutation({
  args: {
    organizationId: v.id('organizations'),
    notificationId: v.id('notifications'),
  },
  handler: async (ctx, args) => {
    await assertAuthenticatedUserInOrganization(ctx, args.organizationId)

    const notification = await ctx.db.get(args.notificationId)
    if (!notification || notification.organizationId !== args.organizationId) {
      return { updated: false }
    }

    await ctx.db.patch(args.notificationId, {
      isDismissed: true,
      isRead: true,
      readAt: notification.readAt ?? Date.now(),
    })
    return { updated: true }
  },
})

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    let deleted = 0

    // Remove expired notifications
    const expired = await ctx.db
      .query('notifications')
      .withIndex('by_expires')
      .take(CLEANUP_BATCH_SIZE)

    for (const n of expired) {
      if (n.expiresAt && n.expiresAt <= now) {
        await ctx.db.delete(n._id)
        deleted++
      }
    }

    // Remove old dismissed notifications (> 30 days)
    const cutoff = now - NOTIFICATION_MAX_AGE_MS
    const oldDismissed = await ctx.db
      .query('notifications')
      .withIndex('by_org_user_dismissed')
      .take(CLEANUP_BATCH_SIZE * 2)

    for (const n of oldDismissed) {
      if (n.isDismissed && n.createdAt < cutoff) {
        await ctx.db.delete(n._id)
        deleted++
      }
    }

    // Remove old read notifications (> 30 days)
    const oldRead = await ctx.db
      .query('notifications')
      .withIndex('by_expires')
      .take(CLEANUP_BATCH_SIZE * 2)

    for (const n of oldRead) {
      if (n.isRead && !n.isDismissed && n.createdAt < cutoff) {
        await ctx.db.delete(n._id)
        deleted++
      }
    }

    if (deleted > 0) {
      console.log(`[Notifications] Cleaned up ${deleted} notifications`)
    }

    return { deleted }
  },
})

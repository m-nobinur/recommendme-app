import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'

type NotificationCategory =
  | 'approval'
  | 'agent'
  | 'crm'
  | 'memory'
  | 'budget'
  | 'communication'
  | 'system'

type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'

interface NotifyArgs {
  organizationId: Id<'organizations'>
  userId?: Id<'appUsers'>
  category: NotificationCategory
  severity: NotificationSeverity
  title: string
  body?: string
  actionUrl?: string
  actionLabel?: string
  referenceType?: string
  referenceId?: string
  expiresAt?: number
}

/**
 * Insert a notification directly via ctx.db (for use in mutations).
 * For actions, schedule the internal mutation instead.
 */
export async function createNotification(
  ctx: {
    db: { insert: (...args: any[]) => Promise<any> }
    scheduler?: { runAfter: (...args: any[]) => Promise<unknown> }
  },
  args: NotifyArgs
): Promise<void> {
  try {
    await ctx.db.insert('notifications', {
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
      createdAt: Date.now(),
    })

    if (ctx.scheduler) {
      await ctx.scheduler.runAfter(0, internal.pushDispatch.sendPush, {
        organizationId: args.organizationId,
        userId: args.userId,
        title: args.title,
        body: args.body,
        actionUrl: args.actionUrl,
        category: args.category,
        severity: args.severity,
      })
    }
  } catch (error) {
    console.warn('[Notify] Failed to create notification (non-fatal):', {
      category: args.category,
      title: args.title,
      error: error instanceof Error ? error.message : 'Unknown',
    })
  }
}

'use node'

import { v } from 'convex/values'
import webpush from 'web-push'
import { internal } from './_generated/api'
import { internalAction } from './_generated/server'

/**
 * Web Push dispatch action.
 *
 * Called after a notification is inserted into the `notifications` table.
 * Looks up all push subscriptions for the target user (or all org members
 * if no userId is set) and sends a Web Push message to each.
 *
 * Mutations live in pushSubscriptions.ts (no 'use node') because
 * Convex requires 'use node' files only export actions.
 *
 * VAPID keys are read from environment variables:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
 */

function getVapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT

  if (!publicKey || !privateKey || !subject) return null
  return { publicKey, privateKey, subject }
}

export const sendPush = internalAction({
  args: {
    organizationId: v.id('organizations'),
    userId: v.optional(v.id('appUsers')),
    title: v.string(),
    body: v.optional(v.string()),
    actionUrl: v.optional(v.string()),
    category: v.string(),
    severity: v.string(),
  },
  handler: async (ctx, args) => {
    const vapid = getVapidConfig()
    if (!vapid) {
      return { sent: 0, failed: 0, skipped: true }
    }

    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)

    const subscriptions = args.userId
      ? await ctx.runQuery(internal.pushSubscriptions.getByUser, { userId: args.userId })
      : await ctx.runQuery(internal.pushSubscriptions.getByOrg, {
          organizationId: args.organizationId,
        })

    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0, skipped: false }
    }

    const payload = JSON.stringify({
      title: args.title,
      body: args.body ?? '',
      url: args.actionUrl ?? '/',
      category: args.category,
      severity: args.severity,
      timestamp: Date.now(),
    })

    let sent = 0
    let failed = 0
    const staleEndpoints: string[] = []

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
          { TTL: 60 * 60 }
        )
        sent++
      } catch (err: any) {
        failed++
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          staleEndpoints.push(sub.endpoint)
        } else {
          console.warn('[PushDispatch] Failed to send push:', {
            endpoint: sub.endpoint.slice(0, 60),
            statusCode: err?.statusCode,
            message: err?.message,
          })
        }
      }
    }

    if (staleEndpoints.length > 0) {
      await ctx.runMutation(internal.pushSubscriptions.removeStaleSubscriptions, {
        endpoints: staleEndpoints,
      })
    }

    return { sent, failed, skipped: false }
  },
})

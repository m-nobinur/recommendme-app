'use node'

import { v } from 'convex/values'
import { Resend } from 'resend'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction, internalMutation, internalQuery, query } from './_generated/server'
import { assertAuthenticatedUserInOrganization } from './lib/auth'
import { isCronDisabled } from './lib/cronGuard'

/**
 * Communication Worker (Phase 8.7)
 *
 * Processes the outbound communication queue — delivers messages through
 * pluggable channel adapters (email via Resend, SMS via Twilio, in-app).
 *
 * When no delivery provider is configured, messages are logged and marked
 * as 'skipped' (same graceful-degradation pattern as LLM workers).
 *
 * Email rendering uses react-email templates (src/lib/email/templates.tsx).
 * Delivery tracking via Resend webhooks (POST /api/webhooks/resend).
 *
 * Flow:
 *   1. Fetch pending messages (batch of MAX_BATCH_SIZE)
 *   2. For each: claim → render template → deliver via adapter → mark sent/failed
 *   3. Retry failed messages up to maxRetries
 *
 * Schedule: every 5 minutes
 */

const MAX_BATCH_SIZE = 20
const MAX_RETRIES_DEFAULT = 3
const DEFAULT_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'notifications@recommendme.app'

type Channel = 'email' | 'sms' | 'in_app'

function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

function isSmsConfigured(): boolean {
  return !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN
}

export const enqueue = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    channel: v.union(v.literal('email'), v.literal('sms'), v.literal('in_app')),
    recipientType: v.union(v.literal('lead'), v.literal('user')),
    recipientId: v.string(),
    recipientAddress: v.optional(v.string()),
    subject: v.optional(v.string()),
    body: v.string(),
    sourceType: v.union(
      v.literal('agent_followup'),
      v.literal('agent_reminder'),
      v.literal('agent_invoice'),
      v.literal('agent_sales'),
      v.literal('system')
    ),
    sourceExecutionId: v.optional(v.id('agentExecutions')),
    priority: v.optional(v.union(v.literal('low'), v.literal('normal'), v.literal('high'))),
    scheduledAt: v.optional(v.number()),
    templateName: v.optional(v.string()),
    templateProps: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    return await ctx.db.insert('communicationQueue', {
      organizationId: args.organizationId,
      channel: args.channel,
      status: 'pending',
      recipientType: args.recipientType,
      recipientId: args.recipientId,
      recipientAddress: args.recipientAddress,
      subject: args.subject,
      body: args.body,
      sourceType: args.sourceType,
      sourceExecutionId: args.sourceExecutionId,
      priority: args.priority ?? 'normal',
      scheduledAt: args.scheduledAt,
      templateName: args.templateName,
      templateProps: args.templateProps,
      retryCount: 0,
      maxRetries: MAX_RETRIES_DEFAULT,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const getPendingBatch = internalQuery({
  args: { limit: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query('communicationQueue')
      .withIndex('by_status_scheduled', (q) => q.eq('status', 'pending'))
      .take(args.limit * 2)

    return pending.filter((m) => !m.scheduledAt || m.scheduledAt <= args.now).slice(0, args.limit)
  },
})

export const claimMessage = internalMutation({
  args: { id: v.id('communicationQueue') },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.id)
    if (!msg || msg.status !== 'pending') return false
    await ctx.db.patch(args.id, { status: 'sending', updatedAt: Date.now() })
    return true
  },
})

export const markSent = internalMutation({
  args: {
    id: v.id('communicationQueue'),
    externalMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    await ctx.db.patch(args.id, {
      status: 'sent',
      sentAt: now,
      updatedAt: now,
      externalMessageId: args.externalMessageId,
      deliveryStatus: 'sent',
    })
  },
})

export const markFailed = internalMutation({
  args: { id: v.id('communicationQueue'), error: v.string() },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.id)
    if (!msg) return

    const retryCount = msg.retryCount + 1
    const status = retryCount >= msg.maxRetries ? 'failed' : 'pending'
    await ctx.db.patch(args.id, {
      status,
      error: args.error,
      retryCount,
      updatedAt: Date.now(),
    })
  },
})

export const markSkipped = internalMutation({
  args: { id: v.id('communicationQueue'), reason: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: 'skipped',
      error: args.reason,
      updatedAt: Date.now(),
    })
  },
})

export const updateDeliveryStatus = internalMutation({
  args: {
    externalMessageId: v.string(),
    deliveryStatus: v.union(
      v.literal('sent'),
      v.literal('delivered'),
      v.literal('delivery_delayed'),
      v.literal('bounced'),
      v.literal('complained')
    ),
  },
  handler: async (ctx, args) => {
    const msg = await ctx.db
      .query('communicationQueue')
      .withIndex('by_external_id', (q) => q.eq('externalMessageId', args.externalMessageId))
      .first()

    if (!msg) return

    const update: Record<string, unknown> = {
      deliveryStatus: args.deliveryStatus,
      deliveryUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    }

    if (args.deliveryStatus === 'bounced' || args.deliveryStatus === 'complained') {
      update.status = 'failed'
      update.error = `Email ${args.deliveryStatus}`
    }

    await ctx.db.patch(msg._id, update)
  },
})

async function renderTemplate(
  templateName: string | undefined,
  templateProps: Record<string, string | undefined> | undefined,
  fallbackBody: string
): Promise<string> {
  if (!templateName || !templateProps) return fallbackBody

  try {
    const { renderEmailHtml } = await import('../lib/email/templates')
    return await renderEmailHtml({
      template: templateName as 'followup' | 'reminder' | 'invoice' | 'generic',
      props: templateProps,
    })
  } catch {
    return fallbackBody
  }
}

async function deliverEmail(
  to: string,
  subject: string,
  body: string,
  templateName?: string,
  templateProps?: Record<string, string | undefined>
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  if (!isEmailConfigured()) {
    return { success: false, error: 'RESEND_API_KEY not configured' }
  }

  const html = await renderTemplate(templateName, templateProps, body)
  const resend = new Resend(process.env.RESEND_API_KEY)

  const { data, error } = await resend.emails.send({
    from: DEFAULT_FROM_EMAIL,
    to,
    subject,
    html,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, messageId: data?.id }
}

async function deliverSms(
  _to: string,
  _body: string
): Promise<{ success: boolean; error?: string }> {
  if (!isSmsConfigured()) {
    return { success: false, error: 'Twilio credentials not configured' }
  }

  return { success: false, error: 'SMS delivery not yet implemented — awaiting Twilio setup' }
}

export const processQueue = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{ processed: number; sent: number; failed: number; skipped: number }> => {
    if (isCronDisabled()) return { processed: 0, sent: 0, failed: 0, skipped: 0 }

    const now = Date.now()
    const batch = (await ctx.runQuery(internal.communicationWorker.getPendingBatch, {
      limit: MAX_BATCH_SIZE,
      now,
    })) as Array<{
      _id: Id<'communicationQueue'>
      organizationId: Id<'organizations'>
      channel: Channel
      recipientAddress?: string
      recipientId: string
      subject?: string
      body: string
      templateName?: string
      templateProps?: Record<string, string | undefined>
    }>

    if (batch.length === 0) return { processed: 0, sent: 0, failed: 0, skipped: 0 }

    let sent = 0
    let failed = 0
    let skipped = 0

    for (const msg of batch) {
      const claimed = await ctx.runMutation(internal.communicationWorker.claimMessage, {
        id: msg._id,
      })
      if (!claimed) continue

      try {
        let result: { success: boolean; error?: string; messageId?: string }

        switch (msg.channel) {
          case 'email': {
            if (!msg.recipientAddress) {
              result = { success: false, error: 'No recipient email address' }
            } else {
              result = await deliverEmail(
                msg.recipientAddress,
                msg.subject ?? '',
                msg.body,
                msg.templateName,
                msg.templateProps
              )
            }
            break
          }
          case 'sms': {
            if (!msg.recipientAddress) {
              result = { success: false, error: 'No recipient phone number' }
            } else {
              result = await deliverSms(msg.recipientAddress, msg.body)
            }
            break
          }
          case 'in_app': {
            result = { success: true }
            break
          }
        }

        if (result.success) {
          await ctx.runMutation(internal.communicationWorker.markSent, {
            id: msg._id,
            externalMessageId: result.messageId,
          })
          sent++
        } else if (result.error?.includes('not configured')) {
          await ctx.runMutation(internal.communicationWorker.markSkipped, {
            id: msg._id,
            reason: result.error,
          })
          skipped++
        } else {
          await ctx.runMutation(internal.communicationWorker.markFailed, {
            id: msg._id,
            error: result.error ?? 'Unknown delivery error',
          })
          failed++
        }
      } catch (error) {
        await ctx.runMutation(internal.communicationWorker.markFailed, {
          id: msg._id,
          error: error instanceof Error ? error.message : 'Unexpected delivery error',
        })
        failed++
      }
    }

    if (sent + failed + skipped > 0) {
      console.log(
        `[Communication] Processed ${batch.length}: ${sent} sent, ${failed} failed, ${skipped} skipped`
      )
    }

    return { processed: batch.length, sent, failed, skipped }
  },
})

export const listByOrg = query({
  args: {
    organizationId: v.id('organizations'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertAuthenticatedUserInOrganization(ctx, args.organizationId)
    return await ctx.db
      .query('communicationQueue')
      .withIndex('by_org_created', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')
      .take(args.limit ?? 50)
  },
})

export const getStats = query({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) => {
    await assertAuthenticatedUserInOrganization(ctx, args.organizationId)

    const recent = await ctx.db
      .query('communicationQueue')
      .withIndex('by_org_created', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')
      .take(200)

    const byStatus: Record<string, number> = {}
    const byChannel: Record<string, number> = {}
    const byDelivery: Record<string, number> = {}
    for (const msg of recent) {
      byStatus[msg.status] = (byStatus[msg.status] ?? 0) + 1
      byChannel[msg.channel] = (byChannel[msg.channel] ?? 0) + 1
      if (msg.deliveryStatus) {
        byDelivery[msg.deliveryStatus] = (byDelivery[msg.deliveryStatus] ?? 0) + 1
      }
    }

    return { total: recent.length, byStatus, byChannel, byDelivery }
  },
})

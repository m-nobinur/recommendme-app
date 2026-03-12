import { v } from 'convex/values'
import { internalMutation, internalQuery, query } from './_generated/server'
import { assertAuthenticatedUserInOrganization } from './lib/auth'

/**
 * Communication Queue — mutations & queries.
 *
 * Separated from communicationWorker.ts (which is 'use node' for Resend/Twilio)
 * because Convex requires that 'use node' files only export actions.
 */

const MAX_RETRIES_DEFAULT = 3

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

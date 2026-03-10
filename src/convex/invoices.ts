import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

const invoiceStatusValues = v.union(v.literal('draft'), v.literal('sent'), v.literal('paid'))

/**
 * Create a new invoice
 */
export const create = mutation({
  args: {
    organizationId: v.id('organizations'),
    userId: v.id('appUsers'),
    leadId: v.id('leads'),
    leadName: v.string(),
    amount: v.number(),
    description: v.optional(v.string()),
    items: v.optional(
      v.array(
        v.object({
          name: v.string(),
          quantity: v.number(),
          price: v.number(),
        })
      )
    ),
    dueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const invoiceId = await ctx.db.insert('invoices', {
      organizationId: args.organizationId,
      leadId: args.leadId,
      leadName: args.leadName,
      amount: args.amount,
      status: 'draft',
      description: args.description,
      items: args.items,
      createdAt: now,
      createdBy: args.userId,
      updatedAt: now,
      dueDate: args.dueDate,
    })

    return invoiceId
  },
})

/**
 * Create invoice by lead name (for AI tools)
 */
export const createByLeadName = mutation({
  args: {
    organizationId: v.id('organizations'),
    userId: v.id('appUsers'),
    leadName: v.string(),
    amount: v.number(),
    description: v.optional(v.string()),
    items: v.optional(v.array(v.string())),
    dueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const leads = await ctx.db
      .query('leads')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .take(500)

    const searchTerm = args.leadName.toLowerCase()
    const lead = leads.find((l) => l.name.toLowerCase().includes(searchTerm))

    if (!lead) {
      return {
        success: false,
        error: 'Lead not found',
      }
    }

    const now = Date.now()

    // Convert string items to proper format
    const formattedItems = args.items?.map((item) => ({
      name: item,
      quantity: 1,
      price: args.amount / (args.items?.length || 1),
    }))

    const invoiceId = await ctx.db.insert('invoices', {
      organizationId: args.organizationId,
      leadId: lead._id,
      leadName: lead.name,
      amount: args.amount,
      status: 'draft',
      description: args.description || 'Service',
      items: formattedItems,
      createdAt: now,
      createdBy: args.userId,
      updatedAt: now,
      dueDate: args.dueDate,
    })

    // Update lead status to Proposal
    await ctx.db.patch(lead._id, {
      status: 'Proposal',
      updatedAt: now,
    })

    return {
      success: true,
      invoiceId,
      leadId: lead._id,
      leadName: lead.name,
      message: `Invoice #${invoiceId.slice(-6)} created for ${lead.name} - $${args.amount}`,
    }
  },
})

/**
 * Update invoice
 */
export const update = mutation({
  args: {
    id: v.id('invoices'),
    status: v.optional(invoiceStatusValues),
    amount: v.optional(v.number()),
    description: v.optional(v.string()),
    dueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args
    const filteredUpdates: Record<string, any> = Object.fromEntries(
      Object.entries(updates).filter(([_, val]) => val !== undefined)
    )

    filteredUpdates.updatedAt = Date.now()

    // Set paidAt if status is changing to paid
    if (args.status === 'paid') {
      filteredUpdates.paidAt = Date.now()
    }

    await ctx.db.patch(id, filteredUpdates)
    return { success: true }
  },
})

/**
 * Delete an invoice
 */
export const remove = mutation({
  args: { id: v.id('invoices') },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id)
    return { success: true }
  },
})

/**
 * Get a single invoice
 */
export const get = query({
  args: { id: v.id('invoices') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id)
  },
})

/**
 * List invoices for an organization
 */
export const list = query({
  args: {
    organizationId: v.id('organizations'),
    status: v.optional(invoiceStatusValues),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const effectiveLimit = Math.min(args.limit ?? 200, 500)

    const q = ctx.db
      .query('invoices')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')

    if (!args.status) {
      return await q.take(effectiveLimit)
    }

    const invoices = await q.take(effectiveLimit * 3)
    return invoices.filter((i) => i.status === args.status).slice(0, effectiveLimit)
  },
})

/**
 * Get invoices for a specific lead
 */
export const listByLead = query({
  args: { leadId: v.id('leads') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('invoices')
      .withIndex('by_lead', (q) => q.eq('leadId', args.leadId))
      .order('desc')
      .take(200)
  },
})

/**
 * Get invoice statistics
 */
export const getStats = query({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) => {
    const invoices = await ctx.db
      .query('invoices')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .take(1000)

    const stats = {
      total: invoices.length,
      byStatus: {} as Record<string, number>,
      totalAmount: 0,
      paidAmount: 0,
      pendingAmount: 0,
    }

    for (const invoice of invoices) {
      stats.byStatus[invoice.status] = (stats.byStatus[invoice.status] || 0) + 1
      stats.totalAmount += invoice.amount

      if (invoice.status === 'paid') {
        stats.paidAmount += invoice.amount
      } else {
        stats.pendingAmount += invoice.amount
      }
    }

    return stats
  },
})

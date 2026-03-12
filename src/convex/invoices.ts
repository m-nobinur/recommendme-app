import { v } from 'convex/values'
import { isValid, parseISO } from 'date-fns'
import type { Id } from './_generated/dataModel'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { assertUserInOrganization } from './lib/auth'
import { createNotification } from './lib/notify'

const invoiceStatusValues = v.union(v.literal('draft'), v.literal('sent'), v.literal('paid'))
const PROPOSAL_TRANSITION_STATUSES = new Set(['New', 'Contacted', 'Qualified'])

function assertPositiveInvoiceAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invoice amount must be a positive number')
  }
}

function buildInvoiceItemsFromNames(items: string[] | undefined, amount: number) {
  if (!items) return undefined
  const cleanItems = items.map((item) => item.trim()).filter((item) => item.length > 0)
  if (cleanItems.length === 0) return undefined
  const perItemPrice = amount / cleanItems.length
  return cleanItems.map((item) => ({
    name: item,
    quantity: 1,
    price: perItemPrice,
  }))
}

function parseIsoDateToMs(value: string | undefined): number | null {
  if (!value) return null
  const parsed = parseISO(value)
  return isValid(parsed) ? parsed.getTime() : null
}

async function appendOverdueInvoiceNoteToLead(
  ctx: { db: { get: MutationGet; patch: MutationPatch } },
  args: {
    organizationId: Id<'organizations'>
    invoiceId: Id<'invoices'>
    notes: string
  }
) {
  const invoice = await ctx.db.get(args.invoiceId)
  if (!invoice || invoice.organizationId !== args.organizationId) {
    throw new Error('Invoice not found or does not belong to this organization')
  }

  const lead = await ctx.db.get(invoice.leadId)
  if (!lead || lead.organizationId !== args.organizationId) {
    throw new Error('Lead not found or access denied')
  }

  const noteText = args.notes.trim()
  if (!noteText) return { applied: false, reason: 'empty' as const }

  const timestamp = new Date().toISOString().split('T')[0]
  const marker = `[Invoice ${timestamp}]`
  const existing = lead.notes ?? ''
  if (existing.includes(marker)) return { applied: false, reason: 'duplicate' as const }

  const updatedNotes = existing ? `${existing}\n${marker} ${noteText}` : `${marker} ${noteText}`

  await ctx.db.patch(lead._id, {
    notes: updatedNotes,
    lastContact: Date.now(),
    updatedAt: Date.now(),
  })

  return { applied: true as const }
}

type MutationGet = (id: Id<any>) => Promise<any>
type MutationPatch = (id: Id<any>, value: Record<string, unknown>) => Promise<void>

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
    await assertUserInOrganization(ctx, args.userId, args.organizationId)
    assertPositiveInvoiceAmount(args.amount)

    const lead = await ctx.db.get(args.leadId)
    if (!lead || lead.organizationId !== args.organizationId) {
      throw new Error('Lead not found or access denied')
    }

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
    await assertUserInOrganization(ctx, args.userId, args.organizationId)
    assertPositiveInvoiceAmount(args.amount)

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

    const formattedItems = buildInvoiceItemsFromNames(args.items, args.amount)

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

    if (PROPOSAL_TRANSITION_STATUSES.has(lead.status)) {
      await ctx.db.patch(lead._id, {
        status: 'Proposal',
        updatedAt: now,
      })
    }

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
    organizationId: v.id('organizations'),
    userId: v.id('appUsers'),
    id: v.id('invoices'),
    status: v.optional(invoiceStatusValues),
    amount: v.optional(v.number()),
    description: v.optional(v.string()),
    dueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)
    if (args.amount !== undefined) {
      assertPositiveInvoiceAmount(args.amount)
    }

    const invoice = await ctx.db.get(args.id)
    if (!invoice || invoice.organizationId !== args.organizationId) {
      throw new Error('Invoice not found or access denied')
    }

    const { id, userId: _userId, organizationId: _organizationId, ...updates } = args
    const filteredUpdates: Record<string, unknown> = Object.fromEntries(
      Object.entries(updates).filter(([_, val]) => val !== undefined)
    )

    filteredUpdates.updatedAt = Date.now()

    if (args.status === 'paid') {
      filteredUpdates.paidAt = Date.now()
    }

    await ctx.db.patch(id, filteredUpdates)

    if (args.status === 'paid' && invoice.status !== 'paid') {
      await createNotification(ctx, {
        organizationId: args.organizationId,
        userId: args.userId,
        category: 'crm',
        severity: 'success',
        title: `Invoice for ${invoice.leadName} marked as paid`,
        body: `$${invoice.amount.toFixed(2)}`,
        referenceType: 'invoice',
        referenceId: String(id),
      })
    }

    return { success: true }
  },
})

/**
 * Delete an invoice
 */
export const remove = mutation({
  args: {
    organizationId: v.id('organizations'),
    userId: v.id('appUsers'),
    id: v.id('invoices'),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const invoice = await ctx.db.get(args.id)
    if (!invoice || invoice.organizationId !== args.organizationId) {
      throw new Error('Invoice not found or access denied')
    }

    await ctx.db.delete(args.id)
    return { success: true }
  },
})

/**
 * Get a single invoice
 */
export const get = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    id: v.id('invoices'),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)
    const invoice = await ctx.db.get(args.id)
    if (!invoice || invoice.organizationId !== args.organizationId) {
      return null
    }
    return invoice
  },
})

/**
 * List invoices for an organization
 */
export const list = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    status: v.optional(invoiceStatusValues),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)
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
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    leadId: v.id('leads'),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const lead = await ctx.db.get(args.leadId)
    if (!lead || lead.organizationId !== args.organizationId) {
      return []
    }

    const invoices = await ctx.db
      .query('invoices')
      .withIndex('by_lead', (q) => q.eq('leadId', args.leadId))
      .order('desc')
      .take(200)
    return invoices
  },
})

/**
 * Get invoice statistics
 */
export const getStats = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)
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

/**
 * Mark an invoice as paid by lead name. Finds the most recent unpaid
 * invoice for the matching lead and marks it as paid.
 */
export const markAsPaidByLeadName = mutation({
  args: {
    organizationId: v.id('organizations'),
    userId: v.id('appUsers'),
    leadName: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const searchTerm = args.leadName.toLowerCase()
    const invoices = await ctx.db
      .query('invoices')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')
      .take(500)

    const unpaid = invoices.find(
      (i) =>
        (i.status === 'draft' || i.status === 'sent') &&
        i.leadName.toLowerCase().includes(searchTerm)
    )

    if (!unpaid) {
      return {
        success: false,
        error: `No unpaid invoice found for ${args.leadName}`,
      }
    }

    const now = Date.now()
    await ctx.db.patch(unpaid._id, {
      status: 'paid',
      paidAt: now,
      updatedAt: now,
    })

    return {
      success: true,
      invoiceId: unpaid._id,
      leadName: unpaid.leadName,
      amount: unpaid.amount,
      message: `Invoice for ${unpaid.leadName} marked as paid — $${unpaid.amount.toFixed(2)}`,
    }
  },
})

// ── Internal queries for Agent Runner ───────────────────────────────────

/**
 * Get completed appointments that don't have a corresponding invoice yet.
 * Used by the Invoice Agent to find appointments needing invoicing.
 */
export const getCompletedAppointmentsWithoutInvoice = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    maxResults: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const effectiveMax = Math.min(args.maxResults ?? 20, 50)

    const completedAppointments = await ctx.db
      .query('appointments')
      .withIndex('by_org_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'completed')
      )
      .order('desc')
      .take(effectiveMax * 3)

    if (completedAppointments.length === 0) return []

    const invoices = await ctx.db
      .query('invoices')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .take(500)

    const remainingInvoiceCountByLead = new Map<string, number>()
    for (const invoice of invoices) {
      const leadId = String(invoice.leadId)
      remainingInvoiceCountByLead.set(leadId, (remainingInvoiceCountByLead.get(leadId) ?? 0) + 1)
    }

    const unbilledAppointmentIds = new Set<string>()
    for (const appointment of [...completedAppointments].reverse()) {
      const leadId = String(appointment.leadId)
      const remainingInvoices = remainingInvoiceCountByLead.get(leadId) ?? 0
      if (remainingInvoices > 0) {
        remainingInvoiceCountByLead.set(leadId, remainingInvoices - 1)
        continue
      }
      unbilledAppointmentIds.add(String(appointment._id))
    }

    return completedAppointments
      .filter((a) => unbilledAppointmentIds.has(String(a._id)))
      .slice(0, effectiveMax)
      .map((a) => ({
        id: String(a._id),
        leadId: String(a.leadId),
        leadName: a.leadName,
        date: a.date,
        time: a.time,
        title: a.title,
        status: a.status,
      }))
  },
})

/**
 * Get overdue invoices (sent invoices past their due date).
 * Used by the Invoice Agent daily cron for overdue detection.
 */
export const getOverdueInvoices = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    now: v.number(),
    overdueThresholdDays: v.optional(v.number()),
    maxResults: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const thresholdDays = args.overdueThresholdDays ?? 7
    const effectiveMax = Math.min(args.maxResults ?? 20, 50)
    const thresholdMs = thresholdDays * 86_400_000

    const sentInvoices = await ctx.db
      .query('invoices')
      .withIndex('by_org_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'sent')
      )
      .take(500)

    return sentInvoices
      .filter((i) => {
        if (i.status !== 'sent') return false
        const dueMs = parseIsoDateToMs(i.dueDate)
        return dueMs !== null && dueMs < args.now - thresholdMs
      })
      .slice(0, effectiveMax)
      .map((i) => {
        const dueMs = parseIsoDateToMs(i.dueDate) ?? args.now
        return {
          id: String(i._id),
          leadId: String(i.leadId),
          leadName: i.leadName,
          amount: i.amount,
          status: i.status,
          dueDate: i.dueDate,
          daysSinceDue: Math.floor((args.now - dueMs) / 86_400_000),
          createdAt: i.createdAt,
        }
      })
  },
})

export const flagOverdueInvoiceById = mutation({
  args: {
    organizationId: v.id('organizations'),
    userId: v.id('appUsers'),
    invoiceId: v.id('invoices'),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)
    const result = await appendOverdueInvoiceNoteToLead(ctx, args)
    if (!result.applied && result.reason === 'empty') {
      return { success: true, message: 'Skipped empty overdue note' }
    }
    if (!result.applied && result.reason === 'duplicate') {
      return { success: true, message: 'Skipped duplicate overdue note' }
    }
    return { success: true, message: 'Overdue note added to lead' }
  },
})

export const createDraftForLeadInternal = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    leadId: v.id('leads'),
    amount: v.number(),
    description: v.string(),
    dueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertPositiveInvoiceAmount(args.amount)

    const lead = await ctx.db.get(args.leadId)
    if (!lead || lead.organizationId !== args.organizationId) {
      throw new Error('Lead not found or access denied')
    }

    const now = Date.now()
    return await ctx.db.insert('invoices', {
      organizationId: args.organizationId,
      leadId: lead._id,
      leadName: lead.name,
      amount: args.amount,
      status: 'draft',
      description: args.description,
      items: [{ name: args.description, quantity: 1, price: args.amount }],
      createdAt: now,
      createdBy: lead.createdBy,
      updatedAt: now,
      dueDate: args.dueDate,
    })
  },
})

export const updateStatusInternal = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    invoiceId: v.id('invoices'),
    status: invoiceStatusValues,
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId)
    if (!invoice || invoice.organizationId !== args.organizationId) {
      throw new Error('Invoice not found or access denied')
    }

    const updates: {
      status: 'draft' | 'sent' | 'paid'
      updatedAt: number
      paidAt?: number
    } = {
      status: args.status,
      updatedAt: Date.now(),
    }

    if (args.status === 'paid') {
      updates.paidAt = Date.now()
    }

    await ctx.db.patch(args.invoiceId, updates)
    return { success: true }
  },
})

export const flagOverdueInvoiceInternal = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    invoiceId: v.id('invoices'),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    await appendOverdueInvoiceNoteToLead(ctx, args)
  },
})

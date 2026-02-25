import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query } from './_generated/server'

const leadStatusValues = v.union(
  v.literal('New'),
  v.literal('Contacted'),
  v.literal('Qualified'),
  v.literal('Proposal'),
  v.literal('Booked'),
  v.literal('Closed')
)

async function assertUserInOrganization(
  ctx: {
    db: {
      get: (id: Id<'appUsers'>) => Promise<Doc<'appUsers'> | null>
    }
  },
  userId: Id<'appUsers'>,
  organizationId: Id<'organizations'>
) {
  const user = await ctx.db.get(userId)
  if (!user || user.organizationId !== organizationId) {
    throw new Error('Access denied for organization')
  }
}

/**
 * Create a new lead
 */
export const create = mutation({
  args: {
    organizationId: v.id('organizations'),
    userId: v.id('appUsers'),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    value: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const now = Date.now()
    const leadId = await ctx.db.insert('leads', {
      organizationId: args.organizationId,
      name: args.name,
      phone: args.phone,
      email: args.email,
      status: 'New',
      notes: args.notes || '',
      tags: args.tags || [],
      value: args.value,
      createdAt: now,
      createdBy: args.userId,
      updatedAt: now,
    })

    return leadId
  },
})

/**
 * Update an existing lead
 */
export const update = mutation({
  args: {
    userId: v.id('appUsers'),
    id: v.id('leads'),
    organizationId: v.id('organizations'),
    status: v.optional(leadStatusValues),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    value: v.optional(v.number()),
    lastContact: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const { id, organizationId, userId: _, ...updates } = args
    const existing = await ctx.db.get(id)
    if (!existing || existing.organizationId !== organizationId) {
      throw new Error('Lead not found or access denied')
    }

    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, val]) => val !== undefined)
    )

    if (Object.keys(filteredUpdates).length > 0) {
      await ctx.db.patch(id, {
        ...filteredUpdates,
        updatedAt: Date.now(),
      })
    }

    return { success: true }
  },
})

/**
 * Update lead by name (fuzzy match for AI tools)
 */
export const updateByName = mutation({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    nameOrId: v.string(),
    status: v.optional(leadStatusValues),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    addTags: v.optional(v.array(v.string())),
    value: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    // Try to find by exact ID first
    let lead: Doc<'leads'> | null = null
    try {
      // Only try to get by ID if it looks like a valid Convex ID
      if (args.nameOrId.length > 10 && args.nameOrId.startsWith('j')) {
        const possibleDoc = await ctx.db.get(args.nameOrId as any)
        // Verify it's actually a lead document by checking the table
        if (possibleDoc && '_id' in possibleDoc) {
          // Type assertion is safe here because we'll verify the table
          const docWithId = possibleDoc as Doc<'leads'>
          // Check if it has lead-specific properties
          if (
            'name' in docWithId &&
            'organizationId' in docWithId &&
            'status' in docWithId &&
            docWithId.organizationId === args.organizationId
          ) {
            lead = docWithId
          }
        }
      }
    } catch {
      // Not a valid ID, search by name
    }

    // If not found by ID, search by name
    if (!lead) {
      const leads = await ctx.db
        .query('leads')
        .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
        .collect()

      const searchTerm = args.nameOrId.toLowerCase()
      lead = leads.find((l) => l.name.toLowerCase().includes(searchTerm)) ?? null
    }

    if (!lead) {
      return { success: false, error: 'Lead not found' }
    }

    const updates: Record<string, string | number | string[]> = { updatedAt: Date.now() }
    if (args.status) updates.status = args.status
    if (args.phone) updates.phone = args.phone
    if (args.email) updates.email = args.email
    if (args.value) updates.value = args.value
    if (args.notes) {
      updates.notes = lead.notes ? `${lead.notes}\n${args.notes}` : args.notes
    }
    if (args.addTags) {
      updates.tags = [...(lead.tags || []), ...args.addTags]
    }

    await ctx.db.patch(lead._id, updates)

    return {
      success: true,
      leadId: lead._id,
      leadName: lead.name,
      message: `Updated lead "${lead.name}"`,
    }
  },
})

/**
 * Delete a lead
 */
export const remove = mutation({
  args: {
    userId: v.id('appUsers'),
    id: v.id('leads'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const existing = await ctx.db.get(args.id)
    if (!existing || existing.organizationId !== args.organizationId) {
      throw new Error('Lead not found or access denied')
    }

    await ctx.db.delete(args.id)
    return { success: true }
  },
})

/**
 * Get a single lead
 */
export const get = query({
  args: {
    userId: v.id('appUsers'),
    id: v.id('leads'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const lead = await ctx.db.get(args.id)
    if (!lead || lead.organizationId !== args.organizationId) {
      return null
    }
    return lead
  },
})

/**
 * List leads for an organization
 */
export const list = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    status: v.optional(leadStatusValues),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const query = ctx.db
      .query('leads')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))

    const leads = await query.order('desc').collect()

    // Filter by status if provided
    let filteredLeads = leads
    if (args.status) {
      filteredLeads = leads.filter((l) => l.status === args.status)
    }

    // Apply limit
    if (args.limit) {
      filteredLeads = filteredLeads.slice(0, args.limit)
    }

    return filteredLeads
  },
})

/**
 * Search leads by name
 */
export const search = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    query: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const results = await ctx.db
      .query('leads')
      .withSearchIndex('search_leads', (q) =>
        q.search('name', args.query).eq('organizationId', args.organizationId)
      )
      .take(20)

    return results
  },
})

/**
 * Get lead statistics
 */
export const getStats = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const leads = await ctx.db
      .query('leads')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect()

    const stats = {
      total: leads.length,
      byStatus: {} as Record<string, number>,
      totalValue: 0,
      thisMonth: 0,
    }

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()

    for (const lead of leads) {
      stats.byStatus[lead.status] = (stats.byStatus[lead.status] || 0) + 1
      if (lead.value) stats.totalValue += lead.value
      if (lead.createdAt >= monthStart) stats.thisMonth++
    }

    return stats
  },
})

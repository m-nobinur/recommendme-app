import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

const appointmentStatusValues = v.union(
  v.literal('scheduled'),
  v.literal('completed'),
  v.literal('cancelled')
)

/**
 * Create a new appointment
 */
export const create = mutation({
  args: {
    organizationId: v.id('organizations'),
    userId: v.id('appUsers'),
    leadId: v.id('leads'),
    leadName: v.string(),
    date: v.string(), // YYYY-MM-DD
    time: v.string(), // HH:MM
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const appointmentId = await ctx.db.insert('appointments', {
      organizationId: args.organizationId,
      leadId: args.leadId,
      leadName: args.leadName,
      date: args.date,
      time: args.time,
      title: args.title || `Appointment with ${args.leadName}`,
      notes: args.notes,
      status: 'scheduled',
      createdAt: now,
      createdBy: args.userId,
      updatedAt: now,
    })

    return appointmentId
  },
})

/**
 * Create appointment by lead name (for AI tools)
 */
export const createByLeadName = mutation({
  args: {
    organizationId: v.id('organizations'),
    userId: v.id('appUsers'),
    leadName: v.string(),
    date: v.string(),
    time: v.string(),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Find lead by name
    const leads = await ctx.db
      .query('leads')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect()

    const searchTerm = args.leadName.toLowerCase()
    const lead = leads.find((l) => l.name.toLowerCase().includes(searchTerm))

    if (!lead) {
      return {
        success: false,
        error: 'Lead not found. Please create the lead first.',
      }
    }

    const now = Date.now()
    const appointmentId = await ctx.db.insert('appointments', {
      organizationId: args.organizationId,
      leadId: lead._id,
      leadName: lead.name,
      date: args.date,
      time: args.time,
      title: args.title || `Appointment with ${lead.name}`,
      notes: args.notes,
      status: 'scheduled',
      createdAt: now,
      createdBy: args.userId,
      updatedAt: now,
    })

    // Update lead status to Booked
    await ctx.db.patch(lead._id, {
      status: 'Booked',
      updatedAt: now,
    })

    return {
      success: true,
      appointmentId,
      leadId: lead._id,
      leadName: lead.name,
      message: `Appointment scheduled with ${lead.name} on ${args.date} at ${args.time}`,
    }
  },
})

/**
 * Update appointment status
 */
export const update = mutation({
  args: {
    id: v.id('appointments'),
    status: v.optional(appointmentStatusValues),
    date: v.optional(v.string()),
    time: v.optional(v.string()),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args
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
 * Delete an appointment
 */
export const remove = mutation({
  args: { id: v.id('appointments') },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id)
    return { success: true }
  },
})

/**
 * Get a single appointment
 */
export const get = query({
  args: { id: v.id('appointments') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id)
  },
})

/**
 * List appointments for an organization
 */
export const list = query({
  args: {
    organizationId: v.id('organizations'),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    status: v.optional(appointmentStatusValues),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const appointments = await ctx.db
      .query('appointments')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')
      .collect()

    let filtered = appointments

    // Filter by date range
    if (args.startDate !== undefined) {
      const startDate = args.startDate
      filtered = filtered.filter((a) => a.date >= startDate)
    }
    if (args.endDate !== undefined) {
      const endDate = args.endDate
      filtered = filtered.filter((a) => a.date <= endDate)
    }

    // Filter by status
    if (args.status) {
      filtered = filtered.filter((a) => a.status === args.status)
    }

    // Apply limit
    if (args.limit) {
      filtered = filtered.slice(0, args.limit)
    }

    return filtered
  },
})

/**
 * Get appointments for a specific lead
 */
export const listByLead = query({
  args: { leadId: v.id('leads') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('appointments')
      .withIndex('by_lead', (q) => q.eq('leadId', args.leadId))
      .order('desc')
      .collect()
  },
})

/**
 * Get upcoming appointments (next 7 days)
 */
export const getUpcoming = query({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) => {
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
    const nextWeekStr = nextWeek.toISOString().split('T')[0]

    const appointments = await ctx.db
      .query('appointments')
      .withIndex('by_org_date', (q) =>
        q.eq('organizationId', args.organizationId).gte('date', todayStr)
      )
      .collect()

    return appointments
      .filter((a) => a.date <= nextWeekStr && a.status === 'scheduled')
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date)
        return a.time.localeCompare(b.time)
      })
  },
})

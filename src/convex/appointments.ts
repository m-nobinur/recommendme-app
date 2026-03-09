import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { mutation, query } from './_generated/server'
import { assertUserInOrganization } from './lib/auth'

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
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const lead = await ctx.db.get(args.leadId)
    if (!lead || lead.organizationId !== args.organizationId) {
      throw new Error('Lead not found or access denied')
    }

    const now = Date.now()
    const appointmentId = await ctx.db.insert('appointments', {
      organizationId: args.organizationId,
      leadId: args.leadId,
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
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

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
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    id: v.id('appointments'),
    status: v.optional(appointmentStatusValues),
    date: v.optional(v.string()),
    time: v.optional(v.string()),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const appointment = await ctx.db.get(args.id)
    if (!appointment || appointment.organizationId !== args.organizationId) {
      throw new Error('Appointment not found or access denied')
    }

    const { id, userId: _userId, organizationId: _organizationId, ...updates } = args
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
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    id: v.id('appointments'),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const appointment = await ctx.db.get(args.id)
    if (!appointment || appointment.organizationId !== args.organizationId) {
      throw new Error('Appointment not found or access denied')
    }

    await ctx.db.delete(args.id)
    return { success: true }
  },
})

/**
 * Get a single appointment
 */
export const get = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    id: v.id('appointments'),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const appointment = await ctx.db.get(args.id)
    if (!appointment || appointment.organizationId !== args.organizationId) {
      return null
    }
    return appointment
  },
})

/**
 * List appointments for an organization
 */
export const list = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    status: v.optional(appointmentStatusValues),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const hasDateRange = args.startDate !== undefined || args.endDate !== undefined
    const status = args.status
    const hasStatus = status !== undefined
    const limit = args.limit !== undefined ? Math.max(1, args.limit) : undefined

    if (hasStatus && !hasDateRange) {
      const queryByStatus = ctx.db
        .query('appointments')
        .withIndex('by_org_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', status)
        )
        .order('desc')

      return limit ? await queryByStatus.take(limit) : await queryByStatus.collect()
    }

    const queryByDate = () =>
      ctx.db
        .query('appointments')
        .withIndex('by_org_date', (q) => {
          if (args.startDate !== undefined && args.endDate !== undefined) {
            return q
              .eq('organizationId', args.organizationId)
              .gte('date', args.startDate)
              .lte('date', args.endDate)
          }
          if (args.startDate !== undefined) {
            return q.eq('organizationId', args.organizationId).gte('date', args.startDate)
          }
          if (args.endDate !== undefined) {
            return q.eq('organizationId', args.organizationId).lte('date', args.endDate)
          }
          return q.eq('organizationId', args.organizationId)
        })
        .order('desc')

    if (!hasStatus && hasDateRange) {
      const scopedByDate = queryByDate()
      return limit ? await scopedByDate.take(limit) : await scopedByDate.collect()
    }

    if (hasStatus && hasDateRange) {
      const scopedByDate = queryByDate()
      const targetLimit = limit ?? Number.POSITIVE_INFINITY
      const pageSize = limit ? Math.max(limit * 3, 50) : 200
      const matches: Doc<'appointments'>[] = []
      let cursor: string | null = null
      let done = false

      while (!done && matches.length < targetLimit) {
        const page = await scopedByDate.paginate({ numItems: pageSize, cursor })
        for (const appointment of page.page) {
          if (appointment.status === status) {
            matches.push(appointment)
            if (matches.length >= targetLimit) break
          }
        }
        done = page.isDone
        cursor = page.continueCursor
      }

      return matches
    }

    const queryByOrg = ctx.db
      .query('appointments')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')
    return limit ? await queryByOrg.take(limit) : await queryByOrg.collect()
  },
})

/**
 * Get appointments for a specific lead
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

    const appointments = await ctx.db
      .query('appointments')
      .withIndex('by_lead', (q) => q.eq('leadId', args.leadId))
      .order('desc')
      .collect()

    return appointments.filter((appointment) => appointment.organizationId === args.organizationId)
  },
})

/**
 * Get upcoming appointments (next 7 days).
 * Accepts `now` as an argument to avoid Date.now() inside a query,
 * which would break Convex's deterministic query caching.
 */
export const getUpcoming = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const today = new Date(args.now)
    const todayStr = today.toISOString().split('T')[0]
    const nextWeek = new Date(args.now + 7 * 24 * 60 * 60 * 1000)
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

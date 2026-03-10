import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { mutation, query } from './_generated/server'
import { assertUserInOrganization } from './lib/auth'
import { resolveTimezone, todayInTimezone } from './lib/timezone'

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
      .take(500)

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
    const effectiveLimit = args.limit !== undefined ? Math.max(1, args.limit) : 500

    if (hasStatus && !hasDateRange) {
      return await ctx.db
        .query('appointments')
        .withIndex('by_org_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', status)
        )
        .order('desc')
        .take(effectiveLimit)
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
      return await queryByDate().take(effectiveLimit)
    }

    if (hasStatus && hasDateRange) {
      const scopedByDate = queryByDate()
      const targetLimit = effectiveLimit
      const pageSize = Math.max(effectiveLimit * 3, 50)
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

    return await ctx.db
      .query('appointments')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')
      .take(effectiveLimit)
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
      .take(200)

    return appointments.filter((a) => a.organizationId === args.organizationId)
  },
})

/**
 * Add a reminder note to an appointment. Uses the same `[Reminder ...]` marker
 * as the cron-based Reminder Agent so both paths are idempotent.
 */
export const setReminderNote = mutation({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    appointmentId: v.id('appointments'),
    reminderMessage: v.string(),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const appointment = await ctx.db.get(args.appointmentId)
    if (!appointment || appointment.organizationId !== args.organizationId) {
      return { success: false, error: 'Appointment not found or access denied' }
    }

    if (appointment.status !== 'scheduled') {
      return {
        success: false,
        error: `Cannot set reminder for ${appointment.status} appointment`,
      }
    }

    const tz = resolveTimezone(args.timezone)
    const timestamp = todayInTimezone(tz)
    const existing = appointment.notes ?? ''
    const marker = `[Reminder ${timestamp}] ${args.reminderMessage}`

    const updatedNotes = existing ? `${existing}\n${marker}` : marker

    await ctx.db.patch(args.appointmentId, {
      notes: updatedNotes,
      updatedAt: Date.now(),
    })

    return {
      success: true,
      appointmentId: args.appointmentId,
      leadName: appointment.leadName,
      date: appointment.date,
      time: appointment.time,
      message: `Reminder set for appointment with ${appointment.leadName} on ${appointment.date} at ${appointment.time}`,
    }
  },
})

/**
 * Find an appointment by lead name and set a reminder note on it.
 * Used by the chat tool when the user doesn't provide an appointment ID.
 */
export const setReminderByLeadName = mutation({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    leadName: v.string(),
    date: v.optional(v.string()),
    reminderMessage: v.string(),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const tz = resolveTimezone(args.timezone)
    const searchTerm = args.leadName.toLowerCase()
    const todayStr = todayInTimezone(tz)

    const appointments = await ctx.db
      .query('appointments')
      .withIndex('by_org_date', (q) =>
        q.eq('organizationId', args.organizationId).gte('date', todayStr)
      )
      .take(200)

    const scheduled = appointments
      .filter((a) => {
        if (a.status !== 'scheduled') return false
        if (!a.leadName.toLowerCase().includes(searchTerm)) return false
        if (args.date && a.date !== args.date) return false
        return true
      })
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date)
        return a.time.localeCompare(b.time)
      })

    if (scheduled.length === 0) {
      return {
        success: false,
        error: args.date
          ? `No scheduled appointment found with ${args.leadName} on ${args.date}`
          : `No upcoming scheduled appointment found with ${args.leadName}`,
      }
    }

    const appointment = scheduled[0]
    const timestamp = todayInTimezone(tz)
    const existing = appointment.notes ?? ''
    const marker = `[Reminder ${timestamp}] ${args.reminderMessage}`
    const updatedNotes = existing ? `${existing}\n${marker}` : marker

    await ctx.db.patch(appointment._id, {
      notes: updatedNotes,
      updatedAt: Date.now(),
    })

    return {
      success: true,
      appointmentId: appointment._id,
      leadName: appointment.leadName,
      date: appointment.date,
      time: appointment.time,
      title: appointment.title,
      message: `Reminder set for appointment with ${appointment.leadName} on ${appointment.date} at ${appointment.time}`,
    }
  },
})

/**
 * Get appointments that have reminder notes, scoped to upcoming scheduled ones.
 */
export const getAppointmentsWithReminders = query({
  args: {
    userId: v.id('appUsers'),
    organizationId: v.id('organizations'),
    now: v.number(),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const tz = resolveTimezone(args.timezone)
    const todayStr = todayInTimezone(tz, args.now)

    const appointments = await ctx.db
      .query('appointments')
      .withIndex('by_org_date', (q) =>
        q.eq('organizationId', args.organizationId).gte('date', todayStr)
      )
      .take(200)

    return appointments
      .filter((a) => a.status === 'scheduled' && a.notes?.includes('[Reminder'))
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date)
        return a.time.localeCompare(b.time)
      })
      .map((a) => ({
        id: a._id,
        leadName: a.leadName,
        date: a.date,
        time: a.time,
        title: a.title,
        notes: a.notes,
        status: a.status,
      }))
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
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertUserInOrganization(ctx, args.userId, args.organizationId)

    const tz = resolveTimezone(args.timezone)
    const todayStr = todayInTimezone(tz, args.now)
    const nextWeekMs = args.now + 7 * 24 * 60 * 60 * 1000
    const nextWeekStr = todayInTimezone(tz, nextWeekMs)

    const appointments = await ctx.db
      .query('appointments')
      .withIndex('by_org_date', (q) =>
        q.eq('organizationId', args.organizationId).gte('date', todayStr)
      )
      .take(200)

    return appointments
      .filter((a) => a.date <= nextWeekStr && a.status === 'scheduled')
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date)
        return a.time.localeCompare(b.time)
      })
  },
})

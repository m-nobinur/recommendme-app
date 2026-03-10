import type { Id } from '@convex/_generated/dataModel'
import { tool } from 'ai'
import { ConvexHttpClient } from 'convex/browser'
import { z } from 'zod'
import type { LeadStatus } from '@/types'
import { asAppUserId, asOrganizationId, getApi } from '../shared/convex'

/**
 * Tool context containing user and organization info.
 * When `convexClient` is provided, tools reuse it instead of creating a new one.
 */
export interface ToolContext {
  organizationId: string
  userId: string
  convexUrl: string
  convexClient?: ConvexHttpClient
  memoryAuthToken?: string
  timezone?: string
}

/**
 * Lead status schema for Zod validation
 */
const leadStatusSchema = z.enum(['New', 'Contacted', 'Qualified', 'Proposal', 'Booked', 'Closed'])

/**
 * Lead data from Convex query
 */
interface ConvexLead {
  _id: Id<'leads'>
  name: string
  status: LeadStatus
  phone?: string
  email?: string
  value?: number
  tags: string[]
}

/**
 * Appointment data from Convex query
 */
interface ConvexAppointment {
  _id: Id<'appointments'>
  leadName: string
  date: string
  time: string
  title?: string
  status: 'scheduled' | 'completed' | 'cancelled'
}

/**
 * Shared tool result types.
 * Re-exported so memory tools and any future tool modules can reuse them.
 */
export interface ToolSuccess<T = unknown> {
  success: true
  data?: T
  message?: string
}

export interface ToolError {
  success: false
  error: string
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolError

export { getApi } from '../shared/convex'

/**
 * Create CRM tools with Convex integration
 */
export function createCRMTools(ctx: ToolContext) {
  const convex = ctx.convexClient ?? new ConvexHttpClient(ctx.convexUrl)
  const orgId = asOrganizationId(ctx.organizationId)
  const userId = asAppUserId(ctx.userId)

  return {
    /**
     * Add a new lead to the CRM
     */
    addLead: tool({
      description:
        'Create a new lead in the CRM. Use this when someone mentions a potential customer or inquiry.',
      inputSchema: z.object({
        name: z.string().describe('Full name of the lead'),
        phone: z.string().optional().describe('Phone number'),
        email: z.email().optional().describe('Email address'),
        notes: z.string().optional().describe('Initial requirements or notes about the lead'),
        tags: z
          .array(z.string())
          .optional()
          .describe("Tags for categorization (e.g., 'Wedding', 'Corporate')"),
        value: z.number().optional().describe('Estimated deal value in dollars'),
      }),
      execute: async (args): Promise<ToolResult<{ leadId: string }>> => {
        try {
          const { api } = await getApi()
          const leadId = await convex.mutation(api.leads.create, {
            organizationId: orgId,
            userId: userId,
            name: args.name,
            phone: args.phone,
            email: args.email,
            notes: args.notes,
            tags: args.tags,
            value: args.value,
          })

          return {
            success: true,
            data: { leadId: leadId as string },
            message: `Lead "${args.name}" has been added to the CRM.`,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to add lead: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    /**
     * Update an existing lead
     */
    updateLead: tool({
      description: "Update an existing lead's information. Use the lead's name to find them.",
      inputSchema: z.object({
        nameOrId: z.string().describe('Name or ID of the lead to update (will fuzzy match)'),
        status: leadStatusSchema.optional().describe('New status for the lead'),
        phone: z.string().optional().describe('Updated phone number'),
        email: z.email().optional().describe('Updated email address'),
        notes: z.string().optional().describe('Additional notes to append'),
        addTags: z.array(z.string()).optional().describe('New tags to add to the lead'),
        value: z.number().optional().describe('Updated deal value'),
      }),
      execute: async (args): Promise<ToolResult<{ leadId: string; leadName: string }>> => {
        try {
          const { api } = await getApi()
          const result = await convex.mutation(api.leads.updateByName, {
            userId,
            organizationId: orgId,
            nameOrId: args.nameOrId,
            status: args.status,
            phone: args.phone,
            email: args.email,
            notes: args.notes,
            addTags: args.addTags,
            value: args.value,
          })

          if ('error' in result && result.error) {
            return { success: false, error: result.error }
          }

          return {
            success: true,
            data: {
              leadId: result.leadId as string,
              leadName: result.leadName as string,
            },
            message: result.message,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to update lead: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    /**
     * Schedule an appointment
     */
    scheduleAppointment: tool({
      description: 'Schedule an appointment with a lead. The lead must exist in the CRM first.',
      inputSchema: z.object({
        leadName: z.string().describe('Name of the lead (will fuzzy match)'),
        date: z.string().describe('Date of the appointment (YYYY-MM-DD format)'),
        time: z.string().describe('Time of the appointment (HH:MM format)'),
        title: z.string().optional().describe('Title or description of the appointment'),
        notes: z.string().optional().describe('Additional notes about the appointment'),
      }),
      execute: async (args): Promise<ToolResult<{ appointmentId: string }>> => {
        try {
          const { api } = await getApi()
          const result = await convex.mutation(api.appointments.createByLeadName, {
            organizationId: orgId,
            userId: userId,
            leadName: args.leadName,
            date: args.date,
            time: args.time,
            title: args.title,
            notes: args.notes,
          })

          if ('error' in result && result.error) {
            return { success: false, error: result.error }
          }

          return {
            success: true,
            data: { appointmentId: result.appointmentId as string },
            message: result.message,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to schedule appointment: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    /**
     * Create an invoice
     */
    createInvoice: tool({
      description: 'Create a new invoice for a customer. The customer must be a lead in the CRM.',
      inputSchema: z.object({
        leadName: z.string().describe('Name of the customer (will fuzzy match)'),
        amount: z.number().describe('Total invoice amount in dollars'),
        description: z.string().optional().describe('Description of the service'),
        items: z.array(z.string()).optional().describe('Line items (if multiple services)'),
        dueDate: z.string().optional().describe('Due date (YYYY-MM-DD format)'),
      }),
      execute: async (args): Promise<ToolResult<{ invoiceId: string }>> => {
        try {
          const { api } = await getApi()
          const result = await convex.mutation(api.invoices.createByLeadName, {
            organizationId: orgId,
            userId: userId,
            leadName: args.leadName,
            amount: args.amount,
            description: args.description,
            items: args.items,
            dueDate: args.dueDate,
          })

          if ('error' in result && result.error) {
            return { success: false, error: result.error }
          }

          return {
            success: true,
            data: { invoiceId: result.invoiceId as string },
            message: result.message,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to create invoice: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    /**
     * List leads
     */
    listLeads: tool({
      description: 'Get a list of leads from the CRM. Can filter by status.',
      inputSchema: z.object({
        status: leadStatusSchema.optional().describe('Filter by status'),
        limit: z.number().optional().describe('Maximum number of leads to return'),
      }),
      execute: async (
        args
      ): Promise<
        ToolResult<{
          leads: Array<{
            name: string
            status: LeadStatus
            phone?: string
            email?: string
            value?: number
            tags: string[]
          }>
          count: number
        }>
      > => {
        try {
          const { api } = await getApi()
          const leads = (await convex.query(api.leads.list, {
            userId,
            organizationId: orgId,
            status: args.status,
            limit: args.limit,
          })) as ConvexLead[]

          return {
            success: true,
            data: {
              leads: leads.map((l) => ({
                name: l.name,
                status: l.status,
                phone: l.phone,
                email: l.email,
                value: l.value,
                tags: l.tags,
              })),
              count: leads.length,
            },
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to list leads: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    /**
     * Get upcoming appointments
     */
    getSchedule: tool({
      description: 'Get upcoming appointments from the schedule.',
      inputSchema: z.object({
        startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
      }),
      execute: async (
        args
      ): Promise<
        ToolResult<{
          appointments: Array<{
            leadName: string
            date: string
            time: string
            title?: string
            status: 'scheduled' | 'completed' | 'cancelled'
          }>
          count: number
        }>
      > => {
        try {
          const { api } = await getApi()
          const appointments = (await convex.query(api.appointments.list, {
            userId,
            organizationId: orgId,
            startDate: args.startDate,
            endDate: args.endDate,
          })) as ConvexAppointment[]

          return {
            success: true,
            data: {
              appointments: appointments.map((a) => ({
                leadName: a.leadName,
                date: a.date,
                time: a.time,
                title: a.title,
                status: a.status,
              })),
              count: appointments.length,
            },
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to get schedule: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),
  }
}

/**
 * Export tool types for use in API routes
 */
export type CRMTools = ReturnType<typeof createCRMTools>

export { createMemoryTools, type MemoryTools } from './memory'
export { createReminderTools, type ReminderTools } from './reminder'

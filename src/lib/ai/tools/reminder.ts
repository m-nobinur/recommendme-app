import { tool } from 'ai'
import { ConvexHttpClient } from 'convex/browser'
import { z } from 'zod'
import { asAppUserId, asOrganizationId, getApi } from '../shared/convex'
import type { ToolContext, ToolResult } from './index'

interface ReminderSetResult {
  appointmentId: string
  leadName: string
  date: string
  time: string
  title?: string
}

interface ReminderListItem {
  leadName: string
  date: string
  time: string
  title?: string
  reminderNotes: string[]
}

/**
 * Create reminder tools for the chat AI.
 *
 * These let the user set reminders on upcoming appointments and check
 * existing reminders through natural conversation.
 */
export function createReminderTools(ctx: ToolContext) {
  const convex = ctx.convexClient ?? new ConvexHttpClient(ctx.convexUrl)
  const orgId = asOrganizationId(ctx.organizationId)
  const userId = asAppUserId(ctx.userId)
  const timezone = ctx.timezone

  return {
    setReminder: tool({
      description:
        'Set a reminder for an upcoming appointment. Finds the appointment by lead/client name and optionally a specific date. Use when a user says "remind me about my appointment with X" or "set a reminder for the meeting with X".',
      inputSchema: z.object({
        leadName: z
          .string()
          .describe(
            'Name of the lead/client whose appointment to set a reminder for (will fuzzy match)'
          ),
        date: z
          .string()
          .optional()
          .describe(
            'Specific date of the appointment (YYYY-MM-DD). If omitted, uses the next upcoming appointment with this lead.'
          ),
        reminderMessage: z
          .string()
          .describe(
            'The reminder note, e.g. "Prepare portfolio samples" or "Confirm meeting time". Keep it actionable and concise.'
          ),
      }),
      execute: async (args): Promise<ToolResult<ReminderSetResult>> => {
        try {
          const { api } = await getApi()
          const result = await convex.mutation(api.appointments.setReminderByLeadName, {
            userId,
            organizationId: orgId,
            leadName: args.leadName,
            date: args.date,
            reminderMessage: args.reminderMessage,
            timezone,
          })

          if ('error' in result && result.error) {
            return { success: false, error: result.error as string }
          }

          return {
            success: true,
            data: {
              appointmentId: result.appointmentId as string,
              leadName: result.leadName as string,
              date: result.date as string,
              time: result.time as string,
              title: result.title as string | undefined,
            },
            message: result.message as string,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to set reminder: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    listReminders: tool({
      description:
        'List all upcoming appointments that have reminders set. Use when the user asks "what reminders do I have?" or "show my reminders".',
      inputSchema: z.object({}),
      execute: async (): Promise<ToolResult<{ reminders: ReminderListItem[]; count: number }>> => {
        try {
          const { api } = await getApi()
          const appointments = await convex.query(api.appointments.getAppointmentsWithReminders, {
            userId,
            organizationId: orgId,
            now: Date.now(),
            timezone,
          })

          const reminders: ReminderListItem[] = (
            appointments as Array<{
              leadName: string
              date: string
              time: string
              title?: string
              notes?: string
            }>
          ).map((a) => {
            const reminderLines = (a.notes ?? '')
              .split('\n')
              .filter((line: string) => line.includes('[Reminder'))
            return {
              leadName: a.leadName,
              date: a.date,
              time: a.time,
              title: a.title,
              reminderNotes: reminderLines,
            }
          })

          return {
            success: true,
            data: { reminders, count: reminders.length },
            message:
              reminders.length > 0
                ? `Found ${reminders.length} appointment(s) with reminders.`
                : 'No upcoming appointments have reminders set.',
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to list reminders: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),
  }
}

export type ReminderTools = ReturnType<typeof createReminderTools>

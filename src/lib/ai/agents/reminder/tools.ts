import type { ConvexHttpClient } from 'convex/browser'
import {
  asAppointmentId,
  asAppUserId,
  asLeadId,
  asOrganizationId,
  getApi,
} from '../../shared/convex'
import type { ActionResult, AgentAction, AgentContext } from '../core/types'

export const REMINDER_ACTIONS = [
  'update_appointment_notes',
  'update_lead_notes',
  'log_reminder_recommendation',
]

async function executeUpdateAppointmentNotes(
  action: AgentAction,
  context: AgentContext,
  convex: ConvexHttpClient
): Promise<ActionResult> {
  const start = Date.now()
  try {
    const notes = String(action.params.notes ?? '').trim()
    if (!notes) {
      return {
        action,
        success: true,
        message: `Skipped empty notes for appointment ${action.target}`,
        durationMs: Date.now() - start,
      }
    }
    const { api } = await getApi()

    const appointment = await convex.query(api.appointments.get, {
      userId: asAppUserId(context.userId),
      organizationId: asOrganizationId(context.organizationId),
      id: asAppointmentId(action.target),
    })

    if (!appointment) {
      return {
        action,
        success: false,
        message: `Appointment not found: ${action.target}`,
        error: `Appointment not found: ${action.target}`,
        durationMs: Date.now() - start,
      }
    }

    const timestamp = new Date().toISOString().split('T')[0]
    const existingNotes = appointment.notes ?? ''
    if (existingNotes.includes(`[Reminder ${timestamp}]`)) {
      return {
        action,
        success: true,
        message: `Skipped duplicate reminder for appointment ${action.target}`,
        durationMs: Date.now() - start,
      }
    }
    const updatedNotes = existingNotes
      ? `${existingNotes}\n[Reminder ${timestamp}] ${notes}`
      : `[Reminder ${timestamp}] ${notes}`

    await convex.mutation(api.appointments.update, {
      userId: asAppUserId(context.userId),
      organizationId: asOrganizationId(context.organizationId),
      id: asAppointmentId(action.target),
      notes: updatedNotes,
    })

    return {
      action,
      success: true,
      message: `Added reminder note to appointment ${action.target}`,
      durationMs: Date.now() - start,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { action, success: false, message, error: message, durationMs: Date.now() - start }
  }
}

async function executeUpdateLeadNotes(
  action: AgentAction,
  context: AgentContext,
  convex: ConvexHttpClient
): Promise<ActionResult> {
  const start = Date.now()
  try {
    const notes = String(action.params.notes ?? '').trim()
    if (!notes) {
      return {
        action,
        success: true,
        message: `Skipped empty notes for lead ${action.target}`,
        durationMs: Date.now() - start,
      }
    }

    const { api } = await getApi()

    const lead = await convex.query(api.leads.get, {
      userId: asAppUserId(context.userId),
      id: asLeadId(action.target),
      organizationId: asOrganizationId(context.organizationId),
    })

    if (!lead) {
      return {
        action,
        success: false,
        message: `Lead not found: ${action.target}`,
        error: `Lead not found: ${action.target}`,
        durationMs: Date.now() - start,
      }
    }

    const timestamp = new Date().toISOString().split('T')[0]
    const existingNotes = lead.notes ?? ''
    if (existingNotes.includes(`[Reminder ${timestamp}]`)) {
      return {
        action,
        success: true,
        message: `Skipped duplicate reminder for lead ${action.target}`,
        durationMs: Date.now() - start,
      }
    }
    const updatedNotes = existingNotes
      ? `${existingNotes}\n[Reminder ${timestamp}] ${notes}`
      : `[Reminder ${timestamp}] ${notes}`

    await convex.mutation(api.leads.update, {
      userId: asAppUserId(context.userId),
      id: asLeadId(action.target),
      organizationId: asOrganizationId(context.organizationId),
      notes: updatedNotes,
      lastContact: Date.now(),
    })
    return {
      action,
      success: true,
      message: `Appended reminder note to lead ${action.target}`,
      durationMs: Date.now() - start,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { action, success: false, message, error: message, durationMs: Date.now() - start }
  }
}

async function executeLogReminderRecommendation(
  action: AgentAction,
  _context: AgentContext,
  _convex: ConvexHttpClient
): Promise<ActionResult> {
  const start = Date.now()
  const recommendation = String(action.params.recommendation ?? '')
  const priority = String(action.params.priority ?? 'medium')

  console.info('[Agent:Reminder] Recommendation logged', {
    target: action.target,
    priority,
    hasRecommendation: recommendation.length > 0,
  })

  return {
    action,
    success: true,
    message: `Logged reminder recommendation for ${action.target}`,
    data: { recommendation, priority },
    durationMs: Date.now() - start,
  }
}

/**
 * Dispatch a reminder action to the appropriate executor.
 */
export async function executeReminderAction(
  action: AgentAction,
  context: AgentContext,
  convex: ConvexHttpClient
): Promise<ActionResult> {
  switch (action.type) {
    case 'update_appointment_notes':
      return executeUpdateAppointmentNotes(action, context, convex)
    case 'update_lead_notes':
      return executeUpdateLeadNotes(action, context, convex)
    case 'log_reminder_recommendation':
      return executeLogReminderRecommendation(action, context, convex)
    default:
      return {
        action,
        success: false,
        message: `Unknown action type: ${action.type}`,
        error: `Unknown action type: ${action.type}`,
        durationMs: 0,
      }
  }
}

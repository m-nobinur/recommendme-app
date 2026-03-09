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
  _context: AgentContext,
  convex: ConvexHttpClient
): Promise<ActionResult> {
  const start = Date.now()
  try {
    const notes = String(action.params.notes ?? '')
    const { api } = await getApi()

    const appointment = await convex.query(api.appointments.get, {
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
    const updatedNotes = existingNotes
      ? `${existingNotes}\n[Reminder ${timestamp}] ${notes}`
      : `[Reminder ${timestamp}] ${notes}`

    await convex.mutation(api.appointments.update, {
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
    const notes = String(action.params.notes ?? '')
    const { api } = await getApi()
    await convex.mutation(api.leads.update, {
      userId: asAppUserId(context.userId),
      id: asLeadId(action.target),
      organizationId: asOrganizationId(context.organizationId),
      notes,
      lastContact: Date.now(),
    })
    return {
      action,
      success: true,
      message: `Updated notes for lead ${action.target}`,
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

  console.info(
    `[Agent:Reminder] Recommendation for ${action.target} [${priority}]: ${recommendation}`
  )

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

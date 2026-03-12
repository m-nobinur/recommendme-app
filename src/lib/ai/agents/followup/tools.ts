import type { ConvexHttpClient } from 'convex/browser'
import { asAppUserId, asLeadId, asOrganizationId, getApi } from '../../shared/convex'
import type { ActionResult, AgentAction, AgentContext } from '../core/types'

export const FOLLOWUP_ACTIONS = ['update_lead_notes', 'update_lead_status', 'log_recommendation']

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

async function executeUpdateLeadStatus(
  action: AgentAction,
  context: AgentContext,
  convex: ConvexHttpClient
): Promise<ActionResult> {
  const start = Date.now()
  try {
    const status = String(action.params.status ?? '')
    const { api } = await getApi()
    await convex.mutation(api.leads.update, {
      userId: asAppUserId(context.userId),
      id: asLeadId(action.target),
      organizationId: asOrganizationId(context.organizationId),
      status: status as 'New' | 'Contacted' | 'Qualified' | 'Proposal' | 'Booked' | 'Closed',
    })
    return {
      action,
      success: true,
      message: `Updated status for lead ${action.target} to '${status}'`,
      durationMs: Date.now() - start,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { action, success: false, message, error: message, durationMs: Date.now() - start }
  }
}

async function executeLogRecommendation(
  action: AgentAction,
  _context: AgentContext,
  _convex: ConvexHttpClient
): Promise<ActionResult> {
  const start = Date.now()
  const recommendation = String(action.params.recommendation ?? '')
  const priority = String(action.params.priority ?? 'medium')

  console.info(
    `[Agent:Followup] Recommendation for ${action.target} [${priority}]: ${recommendation}`
  )

  return {
    action,
    success: true,
    message: `Logged recommendation for lead ${action.target}`,
    data: { recommendation, priority },
    durationMs: Date.now() - start,
  }
}

/**
 * Dispatch a followup action to the appropriate executor.
 */
export async function executeFollowupAction(
  action: AgentAction,
  context: AgentContext,
  convex: ConvexHttpClient
): Promise<ActionResult> {
  switch (action.type) {
    case 'update_lead_notes':
      return executeUpdateLeadNotes(action, context, convex)
    case 'update_lead_status':
      return executeUpdateLeadStatus(action, context, convex)
    case 'log_recommendation':
      return executeLogRecommendation(action, context, convex)
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

import type { ConvexHttpClient } from 'convex/browser'
import { asAppUserId, asOrganizationId, getApi } from '../../shared/convex'
import type { ActionResult, AgentAction, AgentContext } from '../core/types'

export const SALES_ACTIONS = [
  'score_lead',
  'recommend_stage_change',
  'flag_stale_lead',
  'log_pipeline_insight',
]

async function executeScoreLead(
  action: AgentAction,
  context: AgentContext,
  convex: ConvexHttpClient
): Promise<ActionResult> {
  const start = Date.now()
  try {
    const leadName = String(action.params.leadName ?? '').trim()
    const score = Number(action.params.score ?? 0)
    const reasoning = String(action.params.reasoning ?? '').trim()
    const suggestedAction = String(action.params.suggestedAction ?? '').trim()

    if (!leadName || score < 1 || score > 10) {
      return {
        action,
        success: false,
        message: `Invalid score params: leadName="${leadName}", score=${score}`,
        error: 'Missing lead name or invalid score (must be 1-10)',
        durationMs: Date.now() - start,
      }
    }

    const today = new Date().toISOString().slice(0, 10)
    const noteText = `[Sales Score ${today}: ${score}/10] ${reasoning}${suggestedAction ? ` — Next: ${suggestedAction}` : ''}`

    const { api } = await getApi()
    const result = await convex.mutation(api.leads.updateByName, {
      userId: asAppUserId(context.userId),
      organizationId: asOrganizationId(context.organizationId),
      nameOrId: leadName,
      notes: noteText,
    })

    if ('error' in result && result.error) {
      return {
        action,
        success: false,
        message: String(result.error),
        error: String(result.error),
        durationMs: Date.now() - start,
      }
    }

    return {
      action,
      success: true,
      message: `Scored ${leadName} at ${score}/10`,
      data: { leadName, score, reasoning, suggestedAction },
      durationMs: Date.now() - start,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { action, success: false, message, error: message, durationMs: Date.now() - start }
  }
}

async function executeRecommendStageChange(
  action: AgentAction,
  context: AgentContext,
  convex: ConvexHttpClient
): Promise<ActionResult> {
  const start = Date.now()
  try {
    const leadName = String(action.params.leadName ?? '').trim()
    const currentStage = String(action.params.currentStage ?? '')
    const recommendedStage = String(action.params.recommendedStage ?? '')
    const reasoning = String(action.params.reasoning ?? '')

    if (!leadName || !recommendedStage) {
      return {
        action,
        success: false,
        message: `Missing stage change params: leadName="${leadName}", recommendedStage="${recommendedStage}"`,
        error: 'Missing lead name or recommended stage',
        durationMs: Date.now() - start,
      }
    }

    const today = new Date().toISOString().slice(0, 10)
    const noteText = `[Stage Recommendation ${today}] Move to ${recommendedStage} (from ${currentStage}) — ${reasoning}`

    const { api } = await getApi()
    const result = await convex.mutation(api.leads.updateByName, {
      userId: asAppUserId(context.userId),
      organizationId: asOrganizationId(context.organizationId),
      nameOrId: leadName,
      notes: noteText,
    })

    if ('error' in result && result.error) {
      return {
        action,
        success: false,
        message: String(result.error),
        error: String(result.error),
        durationMs: Date.now() - start,
      }
    }

    return {
      action,
      success: true,
      message: `Recommended ${leadName}: ${currentStage} → ${recommendedStage}`,
      data: { leadName, currentStage, recommendedStage, reasoning },
      durationMs: Date.now() - start,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { action, success: false, message, error: message, durationMs: Date.now() - start }
  }
}

async function executeFlagStaleLead(
  action: AgentAction,
  context: AgentContext,
  convex: ConvexHttpClient
): Promise<ActionResult> {
  const start = Date.now()
  try {
    const leadName = String(action.params.leadName ?? '').trim()
    const daysSinceUpdate = Number(action.params.daysSinceUpdate ?? 0)
    const notes = String(action.params.notes ?? '').trim()

    if (!leadName) {
      return {
        action,
        success: false,
        message: 'Missing lead name for stale flag',
        error: 'Missing lead name',
        durationMs: Date.now() - start,
      }
    }

    const today = new Date().toISOString().slice(0, 10)
    const noteText = `[Stale ${today}] Inactive ${daysSinceUpdate}d. ${notes}`

    const { api } = await getApi()
    const result = await convex.mutation(api.leads.updateByName, {
      userId: asAppUserId(context.userId),
      organizationId: asOrganizationId(context.organizationId),
      nameOrId: leadName,
      notes: noteText,
      addTags: ['stale'],
    })

    if ('error' in result && result.error) {
      return {
        action,
        success: false,
        message: String(result.error),
        error: String(result.error),
        durationMs: Date.now() - start,
      }
    }

    return {
      action,
      success: true,
      message: `Flagged ${leadName} as stale (${daysSinceUpdate} days inactive)`,
      data: { leadName, daysSinceUpdate },
      durationMs: Date.now() - start,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { action, success: false, message, error: message, durationMs: Date.now() - start }
  }
}

async function executeLogPipelineInsight(
  action: AgentAction,
  _context: AgentContext,
  _convex: ConvexHttpClient
): Promise<ActionResult> {
  const start = Date.now()
  const insight = String(action.params.insight ?? '')
  const priority = String(action.params.priority ?? 'medium')

  console.info('[Agent:Sales] Pipeline insight logged', {
    target: action.target,
    priority,
    hasInsight: insight.length > 0,
  })

  return {
    action,
    success: true,
    message: `Logged pipeline insight (${priority})`,
    data: { insight, priority },
    durationMs: Date.now() - start,
  }
}

/**
 * Dispatch a sales action to the appropriate executor.
 */
export async function executeSalesAction(
  action: AgentAction,
  context: AgentContext,
  convex: ConvexHttpClient
): Promise<ActionResult> {
  switch (action.type) {
    case 'score_lead':
      return executeScoreLead(action, context, convex)
    case 'recommend_stage_change':
      return executeRecommendStageChange(action, context, convex)
    case 'flag_stale_lead':
      return executeFlagStaleLead(action, context, convex)
    case 'log_pipeline_insight':
      return executeLogPipelineInsight(action, context, convex)
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

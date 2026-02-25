import type { AgentConfig } from './config'
import type { AgentAction, AgentPlan } from './types'

export interface GuardrailResult {
  valid: boolean
  reason?: string
}

/**
 * Check whether a single action is allowed by the agent's guardrails.
 */
export function validateAction(action: AgentAction, config: AgentConfig): GuardrailResult {
  const { allowedActions, maxActionsPerRun } = config.guardrails

  if (allowedActions.length > 0 && !allowedActions.includes(action.type)) {
    return {
      valid: false,
      reason: `Action '${action.type}' is not in the allowed actions list: [${allowedActions.join(', ')}]`,
    }
  }

  if (maxActionsPerRun <= 0) {
    return { valid: false, reason: 'maxActionsPerRun is zero — no actions permitted' }
  }

  return { valid: true }
}

/**
 * Validate an entire plan against agent guardrails.
 *
 * Returns only the actions that pass validation, along with reasons
 * for any that were rejected.
 */
export function validatePlan(
  plan: AgentPlan,
  config: AgentConfig
): {
  approved: AgentAction[]
  rejected: Array<{ action: AgentAction; reason: string }>
} {
  const { maxActionsPerRun } = config.guardrails
  const approved: AgentAction[] = []
  const rejected: Array<{ action: AgentAction; reason: string }> = []

  for (const action of plan.actions) {
    if (approved.length >= maxActionsPerRun) {
      rejected.push({
        action,
        reason: `Exceeded maxActionsPerRun (${maxActionsPerRun})`,
      })
      continue
    }

    const result = validateAction(action, config)
    if (result.valid) {
      approved.push(action)
    } else {
      rejected.push({ action, reason: result.reason ?? 'Unknown guardrail violation' })
    }
  }

  return { approved, rejected }
}

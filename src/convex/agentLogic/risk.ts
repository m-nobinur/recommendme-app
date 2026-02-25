import type { AgentGuardrailsConfig } from './config'
import type { AgentAction, AgentPlan, RiskAssessment, RiskLevel } from './types'

const RISK_SEVERITY: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
}

function isHigherRisk(a: RiskLevel, b: RiskLevel): boolean {
  return RISK_SEVERITY[a] > RISK_SEVERITY[b]
}

function maxRisk(levels: RiskLevel[]): RiskLevel {
  if (levels.length === 0) return 'low'
  return levels.reduce((max, level) => (isHigherRisk(level, max) ? level : max), 'low' as RiskLevel)
}

function isApproved(assessed: RiskLevel, threshold: RiskLevel): boolean {
  return RISK_SEVERITY[assessed] < RISK_SEVERITY[threshold]
}

/**
 * Assess the risk level of a single action.
 *
 * Checks the agent's per-action risk overrides first, then falls back to
 * the action's self-declared risk level.
 */
export function assessAction(
  action: AgentAction,
  guardrails: AgentGuardrailsConfig
): { assessedRisk: RiskLevel; approved: boolean; reason?: string } {
  const overrideRisk = guardrails.riskOverrides[action.type]
  const assessedRisk = overrideRisk ?? action.riskLevel

  if (!isApproved(assessedRisk, guardrails.requireApprovalAbove)) {
    return {
      assessedRisk,
      approved: false,
      reason: `Risk level '${assessedRisk}' requires approval (threshold: '${guardrails.requireApprovalAbove}')`,
    }
  }

  return { assessedRisk, approved: true }
}

/**
 * Assess an entire plan, returning per-action risk assessments and
 * an aggregate risk level.
 */
export function assessPlan(plan: AgentPlan, guardrails: AgentGuardrailsConfig): RiskAssessment {
  const actionAssessments = plan.actions.map((action) => {
    const result = assessAction(action, guardrails)
    return { action, ...result }
  })

  const overallRisk = maxRisk(actionAssessments.map((a) => a.assessedRisk))

  return { overallRisk, actionAssessments }
}

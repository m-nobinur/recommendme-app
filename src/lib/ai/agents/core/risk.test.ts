import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AgentGuardrailsConfig } from './config'
import { assessAction, assessPlan } from './risk'
import type { AgentAction, AgentPlan } from './types'

function makeAction(overrides?: Partial<AgentAction>): AgentAction {
  return {
    type: 'update_lead_notes',
    target: 'lead_123',
    params: { notes: 'Follow up next week' },
    riskLevel: 'low',
    reasoning: 'Stale lead needs attention',
    ...overrides,
  }
}

function makeGuardrails(overrides?: Partial<AgentGuardrailsConfig>): AgentGuardrailsConfig {
  return {
    allowedActions: ['update_lead_notes', 'update_lead_status', 'log_recommendation'],
    maxActionsPerRun: 20,
    riskOverrides: {},
    requireApprovalAbove: 'high',
    ...overrides,
  }
}

describe('assessAction', () => {
  it('approves a low-risk action when threshold is high', () => {
    const result = assessAction(makeAction({ riskLevel: 'low' }), makeGuardrails())
    assert.equal(result.assessedRisk, 'low')
    assert.equal(result.approved, true)
    assert.equal(result.reason, undefined)
  })

  it('approves a medium-risk action when threshold is high', () => {
    const result = assessAction(makeAction({ riskLevel: 'medium' }), makeGuardrails())
    assert.equal(result.assessedRisk, 'medium')
    assert.equal(result.approved, true)
  })

  it('rejects a high-risk action when threshold is high (not strictly less)', () => {
    const result = assessAction(makeAction({ riskLevel: 'high' }), makeGuardrails())
    assert.equal(result.assessedRisk, 'high')
    assert.equal(result.approved, false)
    assert.ok(result.reason?.includes('requires approval'))
  })

  it('applies risk override from guardrails config', () => {
    const guardrails = makeGuardrails({
      riskOverrides: { update_lead_notes: 'high' },
    })
    const result = assessAction(makeAction({ riskLevel: 'low' }), guardrails)
    assert.equal(result.assessedRisk, 'high')
    assert.equal(result.approved, false)
  })

  it('rejects medium-risk action when threshold is medium', () => {
    const guardrails = makeGuardrails({ requireApprovalAbove: 'medium' })
    const result = assessAction(makeAction({ riskLevel: 'medium' }), guardrails)
    assert.equal(result.approved, false)
  })

  it('approves low-risk action when threshold is medium', () => {
    const guardrails = makeGuardrails({ requireApprovalAbove: 'medium' })
    const result = assessAction(makeAction({ riskLevel: 'low' }), guardrails)
    assert.equal(result.approved, true)
  })
})

describe('assessPlan', () => {
  it('returns low overall risk for an empty plan', () => {
    const plan: AgentPlan = { actions: [], summary: '', reasoning: '' }
    const result = assessPlan(plan, makeGuardrails())
    assert.equal(result.overallRisk, 'low')
    assert.equal(result.actionAssessments.length, 0)
  })

  it('returns overall risk equal to the highest action risk', () => {
    const plan: AgentPlan = {
      actions: [
        makeAction({ type: 'update_lead_notes', riskLevel: 'low' }),
        makeAction({ type: 'update_lead_status', riskLevel: 'medium' }),
      ],
      summary: 'Two actions',
      reasoning: 'Mixed risk',
    }
    const result = assessPlan(plan, makeGuardrails())
    assert.equal(result.overallRisk, 'medium')
    assert.equal(result.actionAssessments.length, 2)
  })

  it('marks individual actions as approved/rejected independently', () => {
    const plan: AgentPlan = {
      actions: [
        makeAction({ type: 'update_lead_notes', riskLevel: 'low' }),
        makeAction({ type: 'update_lead_status', riskLevel: 'high' }),
      ],
      summary: 'Mixed approval',
      reasoning: 'One safe, one risky',
    }
    const result = assessPlan(plan, makeGuardrails())
    assert.equal(result.actionAssessments[0].approved, true)
    assert.equal(result.actionAssessments[1].approved, false)
  })

  it('respects risk overrides across multiple actions', () => {
    const guardrails = makeGuardrails({
      riskOverrides: { log_recommendation: 'high' },
    })
    const plan: AgentPlan = {
      actions: [
        makeAction({ type: 'update_lead_notes', riskLevel: 'low' }),
        makeAction({ type: 'log_recommendation', riskLevel: 'low' }),
      ],
      summary: 'Override test',
      reasoning: 'log_recommendation is overridden to high',
    }
    const result = assessPlan(plan, guardrails)
    assert.equal(result.overallRisk, 'high')
    assert.equal(result.actionAssessments[0].approved, true)
    assert.equal(result.actionAssessments[1].approved, false)
  })
})

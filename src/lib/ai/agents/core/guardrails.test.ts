import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AgentConfig } from './config'
import { validateAction, validatePlan } from './guardrails'
import type { AgentAction, AgentPlan } from './types'

function makeAction(overrides?: Partial<AgentAction>): AgentAction {
  return {
    type: 'update_lead_notes',
    target: 'lead_123',
    params: { notes: 'Test note' },
    riskLevel: 'low',
    reasoning: 'Test reasoning',
    ...overrides,
  }
}

function makeConfig(guardrailOverrides?: Partial<AgentConfig['guardrails']>): AgentConfig {
  return {
    agentType: 'followup',
    displayName: 'Test Agent',
    description: 'Test',
    defaultRiskLevel: 'low',
    triggerType: 'cron',
    llm: { model: 'test', temperature: 0, maxTokens: 100 },
    memory: { readLayers: ['business'], writeAgentMemories: false, maxMemoriesPerQuery: 5 },
    guardrails: {
      allowedActions: ['update_lead_notes', 'update_lead_status'],
      maxActionsPerRun: 10,
      riskOverrides: {},
      requireApprovalAbove: 'high',
      ...guardrailOverrides,
    },
    scheduling: { batchSize: 10, cooldownMinutes: 30 },
  }
}

describe('validateAction', () => {
  it('approves an action in the allowed list', () => {
    const result = validateAction(makeAction(), makeConfig())
    assert.equal(result.valid, true)
    assert.equal(result.reason, undefined)
  })

  it('rejects an action not in the allowed list', () => {
    const result = validateAction(makeAction({ type: 'delete_lead' }), makeConfig())
    assert.equal(result.valid, false)
    assert.ok(result.reason?.includes('not in the allowed actions list'))
  })

  it('allows any action when allowedActions is empty (open whitelist)', () => {
    const config = makeConfig({ allowedActions: [] })
    const result = validateAction(makeAction({ type: 'anything' }), config)
    assert.equal(result.valid, true)
  })

  it('rejects all actions when maxActionsPerRun is zero', () => {
    const config = makeConfig({ maxActionsPerRun: 0 })
    const result = validateAction(makeAction(), config)
    assert.equal(result.valid, false)
    assert.ok(result.reason?.includes('maxActionsPerRun is zero'))
  })
})

describe('validatePlan', () => {
  it('approves all actions in a valid plan', () => {
    const plan: AgentPlan = {
      actions: [
        makeAction({ type: 'update_lead_notes' }),
        makeAction({ type: 'update_lead_status' }),
      ],
      summary: 'Valid plan',
      reasoning: 'All allowed',
    }
    const result = validatePlan(plan, makeConfig())
    assert.equal(result.approved.length, 2)
    assert.equal(result.rejected.length, 0)
  })

  it('rejects actions beyond maxActionsPerRun', () => {
    const plan: AgentPlan = {
      actions: [
        makeAction({ type: 'update_lead_notes', target: 'lead_1' }),
        makeAction({ type: 'update_lead_notes', target: 'lead_2' }),
        makeAction({ type: 'update_lead_notes', target: 'lead_3' }),
      ],
      summary: 'Exceeds limit',
      reasoning: 'Three actions, limit is two',
    }
    const config = makeConfig({ maxActionsPerRun: 2 })
    const result = validatePlan(plan, config)
    assert.equal(result.approved.length, 2)
    assert.equal(result.rejected.length, 1)
    assert.ok(result.rejected[0].reason.includes('maxActionsPerRun'))
  })

  it('rejects disallowed actions while approving allowed ones', () => {
    const plan: AgentPlan = {
      actions: [
        makeAction({ type: 'update_lead_notes' }),
        makeAction({ type: 'delete_lead' }),
        makeAction({ type: 'update_lead_status' }),
      ],
      summary: 'Mixed',
      reasoning: 'Some allowed, some not',
    }
    const result = validatePlan(plan, makeConfig())
    assert.equal(result.approved.length, 2)
    assert.equal(result.rejected.length, 1)
    assert.equal(result.rejected[0].action.type, 'delete_lead')
  })

  it('handles an empty plan', () => {
    const plan: AgentPlan = { actions: [], summary: '', reasoning: '' }
    const result = validatePlan(plan, makeConfig())
    assert.equal(result.approved.length, 0)
    assert.equal(result.rejected.length, 0)
  })

  it('enforces maxActionsPerRun before checking allowed list', () => {
    const plan: AgentPlan = {
      actions: [
        makeAction({ type: 'update_lead_notes', target: 'lead_1' }),
        makeAction({ type: 'update_lead_notes', target: 'lead_2' }),
      ],
      summary: 'Limit test',
      reasoning: 'Two actions, limit is one',
    }
    const config = makeConfig({ maxActionsPerRun: 1 })
    const result = validatePlan(plan, config)
    assert.equal(result.approved.length, 1)
    assert.equal(result.rejected.length, 1)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateFollowupPlan } from './followup'

describe('validateFollowupPlan', () => {
  it('parses a well-formed plan', () => {
    const raw = {
      actions: [
        {
          type: 'update_lead_notes',
          target: 'lead_123',
          params: { notes: 'Follow up next week' },
          riskLevel: 'low',
          reasoning: 'Lead has been stale for 5 days',
        },
      ],
      summary: 'One lead needs follow-up',
      reasoning: 'Based on staleness',
    }

    const plan = validateFollowupPlan(raw)
    assert.equal(plan.actions.length, 1)
    assert.equal(plan.actions[0].type, 'update_lead_notes')
    assert.equal(plan.actions[0].target, 'lead_123')
    assert.deepEqual(plan.actions[0].params, { notes: 'Follow up next week' })
    assert.equal(plan.actions[0].riskLevel, 'low')
    assert.equal(plan.summary, 'One lead needs follow-up')
    assert.equal(plan.reasoning, 'Based on staleness')
  })

  it('returns empty actions array when given an empty actions list', () => {
    const raw = { actions: [], summary: 'Nothing to do', reasoning: 'No stale leads' }

    const plan = validateFollowupPlan(raw)
    assert.equal(plan.actions.length, 0)
    assert.equal(plan.summary, 'Nothing to do')
  })

  it('throws when input is null', () => {
    assert.throws(() => validateFollowupPlan(null), /expected an object/)
  })

  it('throws when input is undefined', () => {
    assert.throws(() => validateFollowupPlan(undefined), /expected an object/)
  })

  it('throws when input is a string', () => {
    assert.throws(() => validateFollowupPlan('not an object'), /expected an object/)
  })

  it('throws when actions field is missing', () => {
    assert.throws(() => validateFollowupPlan({ summary: 'no actions' }), /missing or invalid/)
  })

  it('throws when actions is not an array', () => {
    assert.throws(() => validateFollowupPlan({ actions: 'not-array' }), /missing or invalid/)
  })

  it('throws when an action entry is null', () => {
    assert.throws(() => validateFollowupPlan({ actions: [null] }), /expected an object/)
  })

  it('throws when an action entry is a string', () => {
    assert.throws(() => validateFollowupPlan({ actions: ['bad'] }), /expected an object/)
  })

  it('defaults missing fields to safe values', () => {
    const raw = { actions: [{}] }

    const plan = validateFollowupPlan(raw)
    assert.equal(plan.actions[0].type, '')
    assert.equal(plan.actions[0].target, '')
    assert.deepEqual(plan.actions[0].params, {})
    assert.equal(plan.actions[0].riskLevel, 'low')
    assert.equal(plan.actions[0].reasoning, '')
    assert.equal(plan.summary, '')
    assert.equal(plan.reasoning, '')
  })

  it('defaults invalid riskLevel to low', () => {
    const raw = {
      actions: [
        { type: 'log_recommendation', target: 'x', riskLevel: 'extreme', reasoning: 'test' },
      ],
    }

    const plan = validateFollowupPlan(raw)
    assert.equal(plan.actions[0].riskLevel, 'low')
  })

  it('preserves valid riskLevel values', () => {
    for (const level of ['low', 'medium', 'high']) {
      const raw = {
        actions: [{ type: 'log_recommendation', target: 'x', riskLevel: level, reasoning: 'r' }],
      }
      const plan = validateFollowupPlan(raw)
      assert.equal(
        plan.actions[0].riskLevel,
        level,
        `expected riskLevel '${level}' to be preserved`
      )
    }
  })

  it('handles multiple actions', () => {
    const raw = {
      actions: [
        { type: 'update_lead_notes', target: 'a', riskLevel: 'low', reasoning: '1' },
        {
          type: 'update_lead_status',
          target: 'b',
          params: { status: 'Qualified' },
          riskLevel: 'medium',
          reasoning: '2',
        },
        { type: 'log_recommendation', target: 'c', riskLevel: 'high', reasoning: '3' },
      ],
      summary: 'Three actions',
    }

    const plan = validateFollowupPlan(raw)
    assert.equal(plan.actions.length, 3)
    assert.equal(plan.actions[0].riskLevel, 'low')
    assert.equal(plan.actions[1].riskLevel, 'medium')
    assert.equal(plan.actions[2].riskLevel, 'high')
  })

  it('coerces numeric type/target to strings', () => {
    const raw = {
      actions: [{ type: 123, target: 456, riskLevel: 'low', reasoning: 'coerce' }],
    }

    const plan = validateFollowupPlan(raw)
    assert.equal(plan.actions[0].type, '123')
    assert.equal(plan.actions[0].target, '456')
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FollowupHandler } from './handler'

const handler = new FollowupHandler()

describe('FollowupHandler.validatePlan', () => {
  it('parses a valid LLM response into an AgentPlan', () => {
    const raw = {
      actions: [
        {
          type: 'update_lead_notes',
          target: 'lead_abc',
          params: { notes: 'Follow up next Monday' },
          riskLevel: 'low',
          reasoning: 'Lead has been stale for 7 days',
        },
        {
          type: 'log_recommendation',
          target: 'lead_xyz',
          params: { recommendation: 'Send pricing info', priority: 'high' },
          riskLevel: 'low',
          reasoning: 'Lead asked about pricing last week',
        },
      ],
      summary: 'Two followup actions planned',
      reasoning: 'Both leads are overdue for contact',
    }

    const plan = handler.validatePlan(raw)
    assert.equal(plan.actions.length, 2)
    assert.equal(plan.actions[0].type, 'update_lead_notes')
    assert.equal(plan.actions[0].target, 'lead_abc')
    assert.equal(plan.actions[0].riskLevel, 'low')
    assert.equal(plan.actions[1].type, 'log_recommendation')
    assert.equal(plan.summary, 'Two followup actions planned')
    assert.equal(plan.reasoning, 'Both leads are overdue for contact')
  })

  it('throws for null input', () => {
    assert.throws(() => handler.validatePlan(null), /expected an object/)
  })

  it('throws for non-object input', () => {
    assert.throws(() => handler.validatePlan('not an object'), /expected an object/)
  })

  it('throws when actions is missing', () => {
    assert.throws(() => handler.validatePlan({ summary: 'no actions' }), /missing or invalid/)
  })

  it('throws when actions is not an array', () => {
    assert.throws(() => handler.validatePlan({ actions: 'not array' }), /missing or invalid/)
  })

  it('throws when an action is not an object', () => {
    assert.throws(() => handler.validatePlan({ actions: ['not-an-object'] }), /expected an object/)
  })

  it('defaults missing riskLevel to low', () => {
    const raw = {
      actions: [
        {
          type: 'update_lead_notes',
          target: 'lead_1',
          params: {},
          reasoning: 'test',
        },
      ],
      summary: 'test',
      reasoning: 'test',
    }
    const plan = handler.validatePlan(raw)
    assert.equal(plan.actions[0].riskLevel, 'low')
  })

  it('defaults invalid riskLevel to low', () => {
    const raw = {
      actions: [
        {
          type: 'update_lead_notes',
          target: 'lead_1',
          params: {},
          riskLevel: 'critical',
          reasoning: 'test',
        },
      ],
      summary: 'test',
      reasoning: 'test',
    }
    const plan = handler.validatePlan(raw)
    assert.equal(plan.actions[0].riskLevel, 'low')
  })

  it('coerces missing fields to safe defaults', () => {
    const raw = {
      actions: [{ type: undefined, target: undefined, params: undefined }],
      summary: undefined,
      reasoning: undefined,
    }
    const plan = handler.validatePlan(raw)
    assert.equal(plan.actions[0].type, '')
    assert.equal(plan.actions[0].target, '')
    assert.deepEqual(plan.actions[0].params, {})
    assert.equal(plan.actions[0].riskLevel, 'low')
    assert.equal(plan.actions[0].reasoning, '')
  })

  it('handles an empty actions array', () => {
    const plan = handler.validatePlan({ actions: [], summary: 'empty', reasoning: 'nothing' })
    assert.equal(plan.actions.length, 0)
    assert.equal(plan.summary, 'empty')
  })

  it('preserves action params as-is', () => {
    const raw = {
      actions: [
        {
          type: 'update_lead_status',
          target: 'lead_1',
          params: { status: 'Qualified', reason: 'showed interest' },
          riskLevel: 'medium',
          reasoning: 'lead engaged',
        },
      ],
      summary: 'status update',
      reasoning: 'test',
    }
    const plan = handler.validatePlan(raw)
    assert.deepEqual(plan.actions[0].params, { status: 'Qualified', reason: 'showed interest' })
  })
})

describe('FollowupHandler.config', () => {
  it('has followup agent type', () => {
    assert.equal(handler.agentType, 'followup')
  })

  it('config specifies cron trigger', () => {
    assert.equal(handler.config.triggerType, 'cron')
  })

  it('config allowedActions matches FOLLOWUP_ACTIONS', () => {
    const allowed = handler.config.guardrails.allowedActions
    assert.ok(allowed.includes('update_lead_notes'))
    assert.ok(allowed.includes('update_lead_status'))
    assert.ok(allowed.includes('log_recommendation'))
    assert.equal(allowed.length, 3)
  })

  it('config risk overrides cover all allowed actions', () => {
    const overrides = handler.config.guardrails.riskOverrides
    const allowed = handler.config.guardrails.allowedActions
    for (const action of allowed) {
      assert.ok(action in overrides, `riskOverride missing for ${action}`)
    }
  })
})

describe('FollowupHandler.buildPlanPrompt', () => {
  it('returns system and user prompts', () => {
    const context = {
      organizationId: 'org_test',
      userId: 'user_test',
      agentType: 'followup' as const,
      leads: [{ id: 'l1', name: 'Test Lead', status: 'Contacted', tags: [], daysSinceContact: 5 }],
      appointments: [],
      agentMemories: [],
      businessContext: [],
      timestamp: Date.now(),
    }
    const prompt = handler.buildPlanPrompt(context)
    assert.ok(prompt.system.length > 0)
    assert.ok(prompt.user.length > 0)
    assert.ok(prompt.user.includes('Test Lead'))
  })
})

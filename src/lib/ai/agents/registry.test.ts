import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getAgentHandler, getRegisteredAgentTypes, isAgentImplemented } from './registry'

describe('getRegisteredAgentTypes', () => {
  it('returns all four agent types', () => {
    const types = getRegisteredAgentTypes()
    assert.equal(types.length, 4)
    assert.ok(types.includes('followup'))
    assert.ok(types.includes('reminder'))
    assert.ok(types.includes('invoice'))
    assert.ok(types.includes('sales'))
  })
})

describe('isAgentImplemented', () => {
  it('returns true for followup (implemented)', () => {
    assert.equal(isAgentImplemented('followup'), true)
  })

  it('returns false for reminder (not yet implemented)', () => {
    assert.equal(isAgentImplemented('reminder'), false)
  })

  it('returns false for invoice (not yet implemented)', () => {
    assert.equal(isAgentImplemented('invoice'), false)
  })

  it('returns false for sales (not yet implemented)', () => {
    assert.equal(isAgentImplemented('sales'), false)
  })
})

describe('getAgentHandler', () => {
  it('returns a handler for followup agent', () => {
    const handler = getAgentHandler('followup')
    assert.equal(handler.agentType, 'followup')
    assert.equal(typeof handler.loadContext, 'function')
    assert.equal(typeof handler.buildPlanPrompt, 'function')
    assert.equal(typeof handler.validatePlan, 'function')
    assert.equal(typeof handler.executeAction, 'function')
    assert.equal(typeof handler.learn, 'function')
  })

  it('throws for unimplemented agent types', () => {
    assert.throws(() => getAgentHandler('reminder'), /not yet implemented/)
    assert.throws(() => getAgentHandler('invoice'), /not yet implemented/)
    assert.throws(() => getAgentHandler('sales'), /not yet implemented/)
  })

  it('followup handler has the correct config shape', () => {
    const handler = getAgentHandler('followup')
    const config = handler.config

    assert.equal(config.agentType, 'followup')
    assert.equal(config.triggerType, 'cron')
    assert.ok(config.guardrails.allowedActions.length > 0)
    assert.ok(config.guardrails.maxActionsPerRun > 0)
    assert.ok(config.llm.model.length > 0)
    assert.ok(config.memory.readLayers.includes('business'))
    assert.ok(config.memory.readLayers.includes('agent'))
  })
})

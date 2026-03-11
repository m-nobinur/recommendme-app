import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  downgradeModelTier,
  evaluateBudgetRouting,
  resolveBudgetTier,
  trimMemoryContextForBudget,
} from './manager'

describe('cost manager tier helpers', () => {
  it('resolves unknown tier to starter', () => {
    assert.equal(resolveBudgetTier('unknown'), 'starter')
    assert.equal(resolveBudgetTier(undefined), 'starter')
  })

  it('downgrades model tiers one level', () => {
    assert.equal(downgradeModelTier('smartest'), 'smart')
    assert.equal(downgradeModelTier('smart'), 'regular')
    assert.equal(downgradeModelTier('regular'), 'regular')
  })
})

describe('cost manager budget routing', () => {
  it('keeps requested tier when budget is healthy', () => {
    const decision = evaluateBudgetRouting({
      requestedTier: 'smart',
      budgetTier: 'starter',
      usage: { dailyTokensUsed: 1_000, monthlyTokensUsed: 20_000 },
    })

    assert.equal(decision.budget.status, 'ok')
    assert.equal(decision.effectiveTier, 'smart')
    assert.equal(decision.allowLlmCall, true)
    assert.equal(decision.reduceContext, false)
  })

  it('downgrades and reduces context on warning threshold', () => {
    const decision = evaluateBudgetRouting({
      requestedTier: 'smartest',
      budgetTier: 'starter',
      usage: { dailyTokensUsed: 41_000, monthlyTokensUsed: 120_000 },
    })

    assert.equal(decision.budget.status, 'warning')
    assert.equal(decision.effectiveTier, 'smart')
    assert.equal(decision.allowLlmCall, true)
    assert.equal(decision.reduceContext, true)
  })

  it('blocks LLM calls when budget is exceeded', () => {
    const decision = evaluateBudgetRouting({
      requestedTier: 'regular',
      budgetTier: 'free',
      usage: { dailyTokensUsed: 11_000, monthlyTokensUsed: 100_000 },
    })

    assert.equal(decision.budget.status, 'exceeded')
    assert.equal(decision.allowLlmCall, false)
    assert.equal(decision.retryAfterSeconds, 3600)
  })
})

describe('cost manager context reduction', () => {
  it('trims large memory context in reduced-context mode', () => {
    const context = `---\n## What You Know\n\n${'- line\n'.repeat(400)}---`
    const trimmed = trimMemoryContextForBudget(context, { reduceContext: true })
    assert.ok(trimmed.length < context.length)
    assert.ok(trimmed.includes('budget guardrail'))
    assert.ok(trimmed.endsWith('---'))
  })

  it('keeps context unchanged when reduction is disabled', () => {
    const context = '---\n## What You Know\n- A\n---'
    const trimmed = trimMemoryContextForBudget(context, { reduceContext: false })
    assert.equal(trimmed, context)
  })
})

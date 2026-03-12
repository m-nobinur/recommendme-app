import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { allocateTokenBudget, estimateTokens, resetTokenBudgetConfig } from './tokenBudget'

describe('tokenBudget', () => {
  beforeEach(() => {
    resetTokenBudgetConfig()
  })

  it('estimates tokens with 4-char heuristic', () => {
    assert.equal(estimateTokens(''), 0)
    assert.equal(estimateTokens('1234'), 1)
    assert.equal(estimateTokens('12345'), 2)
  })

  it('respects a strict global budget cap', () => {
    const scored = {
      platform: [],
      niche: [],
      business: [
        {
          document: { content: 'x'.repeat(120) },
          relevanceScore: 0.95,
          compositeScore: 0.95,
          layer: 'business' as const,
        },
        {
          document: { content: 'Important short memory' },
          relevanceScore: 0.9,
          compositeScore: 0.9,
          layer: 'business' as const,
        },
      ],
      agent: [],
    }

    const selected = allocateTokenBudget(scored as any, {
      totalBudget: 10,
      platform: 0,
      niche: 0,
      business: 10,
      agent: 0,
      relations: 0,
      conversationSummary: 0,
      maxReallocationPerSection: 0,
    })

    assert.equal(selected.business.length, 1)
    assert.equal(
      (selected.business[0]?.document as { content: string }).content,
      'Important short memory'
    )
    assert.equal(selected.budgetUsage.totalUsed <= 10, true)
  })
})

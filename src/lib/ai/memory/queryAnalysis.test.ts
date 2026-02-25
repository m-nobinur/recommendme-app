import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { analyzeQuery, getRequiredLayers, isMemoryCommand } from './queryAnalysis'

describe('queryAnalysis', () => {
  it('detects memory command intents and skips retrieval layers', () => {
    const analysis = analyzeQuery('Remember that Sarah prefers evening appointments.')
    assert.equal(isMemoryCommand(analysis), true)
    assert.deepEqual(getRequiredLayers(analysis.intents), [])
  })

  it('routes invoicing intents to business layer only', () => {
    const analysis = analyzeQuery('Generate an invoice for the session.')
    assert.equal(analysis.intents.includes('invoicing'), true)
    assert.deepEqual(getRequiredLayers(['invoicing']), ['business'])
  })

  it('extracts lowercase customer name hints with context words', () => {
    const analysis = analyzeQuery('what do you know about sarah and her preferences?')
    assert.equal(
      analysis.subjectHints.some((hint) => hint.name?.toLowerCase() === 'sarah'),
      true
    )
  })
})

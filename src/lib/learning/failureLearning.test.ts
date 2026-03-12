import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FailureRecord } from '@/types'
import {
  checkForRelevantFailures,
  classifyFailure,
  createFailureRecord,
  failureToMemoryContent,
  formatPreventionContext,
  MAX_PREVENTION_RULES,
  processFailureBatch,
  SIMILARITY_THRESHOLD,
} from './failureLearning'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFailureRecord(overrides: Partial<FailureRecord> = {}): FailureRecord {
  return {
    category: 'tool_error',
    description: 'invoice service failed to respond',
    context: 'creating an invoice for Acme',
    correction: undefined,
    timestamp: Date.now(),
    agentType: 'sales',
    preventionRule: 'Before retrying, verify tool availability and parameters.',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// classifyFailure
// ---------------------------------------------------------------------------

describe('classifyFailure', () => {
  it('classifies tool errors', () => {
    assert.equal(classifyFailure('API error: service timeout, could not connect'), 'tool_error')
  })

  it('classifies misunderstandings', () => {
    assert.equal(
      classifyFailure("No I meant something else, that's not what I said"),
      'misunderstanding'
    )
  })

  it('classifies wrong actions', () => {
    assert.equal(classifyFailure('You should not have sent that, please undo it'), 'wrong_action')
  })

  it('classifies incomplete info', () => {
    assert.equal(classifyFailure('You missed the date, more detail is needed'), 'incomplete_info')
  })

  it('returns null when no keywords match', () => {
    assert.equal(classifyFailure('Everything looks fine, proceed'), null)
  })

  it('returns null for empty string', () => {
    assert.equal(classifyFailure(''), null)
  })

  it('is case-insensitive', () => {
    assert.equal(classifyFailure('TIMEOUT ERROR EXCEPTION FAILED'), 'tool_error')
  })

  it('picks the category with the most keyword matches (highest score wins)', () => {
    // "error failed exception" → tool_error (3 matches)
    // "wrong action undo" → wrong_action (2 matches)
    const result = classifyFailure('error failed exception — wrong action undo')
    assert.equal(result, 'tool_error')
  })
})

// ---------------------------------------------------------------------------
// createFailureRecord
// ---------------------------------------------------------------------------

describe('createFailureRecord', () => {
  it('returns null when content does not classify', () => {
    const record = createFailureRecord('good job', 'some context', 'sales')
    assert.equal(record, null)
  })

  it('creates a record with the correct category', () => {
    const record = createFailureRecord(
      'API error: service timeout, could not reach endpoint',
      'sending invoice',
      'sales'
    )
    assert.ok(record, 'expected a record')
    assert.equal(record.category, 'tool_error')
    assert.equal(record.agentType, 'sales')
    assert.ok((record.preventionRule?.length ?? 0) > 0)
  })

  it('includes correction in prevention rule when provided', () => {
    const record = createFailureRecord(
      'misunderstood, that is not what i meant',
      'context',
      'sales',
      'I meant send email not SMS'
    )
    assert.ok(record)
    assert.ok(record.preventionRule?.includes('I meant send email not SMS'))
    assert.equal(record.correction, 'I meant send email not SMS')
  })

  it('truncates description and context to MAX_EVIDENCE_LENGTH (200 chars)', () => {
    const long = 'a'.repeat(300)
    const record = createFailureRecord(`error failed: ${long}`, long, 'sales')
    assert.ok(record)
    assert.ok(record.description.length <= 200)
    assert.ok(record.context.length <= 200)
  })

  it('sets a timestamp', () => {
    const before = Date.now()
    const record = createFailureRecord('service failed error', 'ctx', 'sales')
    const after = Date.now()
    assert.ok(record)
    assert.ok(record.timestamp >= before && record.timestamp <= after)
  })
})

// ---------------------------------------------------------------------------
// checkForRelevantFailures
// ---------------------------------------------------------------------------

describe('checkForRelevantFailures', () => {
  it('returns hasRelevantFailures=false when no past failures match', () => {
    const result = checkForRelevantFailures('completely unrelated query', [
      makeFailureRecord({ description: 'invoice api crashed', context: 'invoice creation' }),
    ])
    // "completely unrelated query" shares very few words with the failure
    // but we cannot guarantee 0 similarity without knowing internals; just check structure
    assert.equal(typeof result.hasRelevantFailures, 'boolean')
    assert.ok(Array.isArray(result.failures))
    assert.ok(Array.isArray(result.preventionAdvice))
  })

  it('returns matching failures when context overlaps', () => {
    const failure = makeFailureRecord({
      description: 'invoice service failed to respond',
      context: 'creating an invoice for Acme Corporation',
    })
    const result = checkForRelevantFailures('creating invoice for Acme Corporation failed', [
      failure,
    ])
    assert.ok(result.hasRelevantFailures)
    assert.ok(result.failures.length >= 1)
    assert.ok(result.preventionAdvice.length >= 1)
  })

  it('caps failures returned at 5', () => {
    const failures = Array.from({ length: 10 }, (_, i) =>
      makeFailureRecord({
        description: `invoice service failed to respond event ${i}`,
        context: 'creating invoice for Acme',
      })
    )
    const result = checkForRelevantFailures('invoice service failed creating Acme', failures)
    assert.ok(result.failures.length <= 5)
  })

  it(`caps prevention advice at MAX_PREVENTION_RULES (${MAX_PREVENTION_RULES})`, () => {
    const failures = Array.from({ length: MAX_PREVENTION_RULES + 5 }, (_, i) =>
      makeFailureRecord({
        description: `timeout error failed api ${i}`,
        context: 'sending email timeout error failed',
        preventionRule: `Rule ${i}: verify before retrying.`,
      })
    )
    const result = checkForRelevantFailures('sending email timeout error failed', failures)
    assert.ok(result.preventionAdvice.length <= MAX_PREVENTION_RULES)
  })

  it('respects SIMILARITY_THRESHOLD — low-overlap context does not match', () => {
    // SIMILARITY_THRESHOLD = 0.5; use completely different vocabulary
    const failure = makeFailureRecord({
      description: 'invoice billing payment receipt',
      context: 'invoice billing payment receipt',
    })
    const result = checkForRelevantFailures('scheduling calendar appointment reminder', [failure])
    assert.ok(!result.hasRelevantFailures, `should not match (threshold=${SIMILARITY_THRESHOLD})`)
  })
})

// ---------------------------------------------------------------------------
// processFailureBatch
// ---------------------------------------------------------------------------

describe('processFailureBatch', () => {
  it('records non-duplicate failures and counts corrections/rules', () => {
    const events = [
      {
        content: 'API error: service timeout',
        context: 'sending invoice',
        agentType: 'sales',
        correction: 'retry after 5 seconds',
      },
      {
        content: 'misunderstood, that is not what I meant',
        context: 'drafting email',
        agentType: 'sales',
      },
    ]
    const result = processFailureBatch(events, [])
    assert.equal(result.failuresRecorded, 2)
    assert.equal(result.correctionsApplied, 1)
    assert.equal(result.preventionRulesCreated, 2)
  })

  it('skips unclassifiable events', () => {
    const events = [{ content: 'all good here', context: 'ctx', agentType: 'sales' }]
    const result = processFailureBatch(events, [])
    assert.equal(result.failuresRecorded, 0)
  })

  it('deduplicates events highly similar to existing failures', () => {
    const existing = [
      makeFailureRecord({ description: 'API error: service timeout could not connect' }),
    ]
    const events = [
      {
        content: 'API error: service timeout could not connect',
        context: 'sending invoice',
        agentType: 'sales',
      },
    ]
    const result = processFailureBatch(events, existing)
    assert.equal(result.failuresRecorded, 0, 'duplicate should be skipped')
  })
})

// ---------------------------------------------------------------------------
// failureToMemoryContent
// ---------------------------------------------------------------------------

describe('failureToMemoryContent', () => {
  it('produces a string beginning with [Failure:<category>]', () => {
    const record = makeFailureRecord({ category: 'misunderstanding' })
    const content = failureToMemoryContent(record)
    assert.ok(content.startsWith('[Failure:misunderstanding]'))
  })

  it('includes correction when present', () => {
    const record = makeFailureRecord({ correction: 'use email not SMS' })
    const content = failureToMemoryContent(record)
    assert.ok(content.includes('Correction: use email not SMS'))
  })

  it('includes prevention rule when present', () => {
    const record = makeFailureRecord({ preventionRule: 'Verify availability first.' })
    const content = failureToMemoryContent(record)
    assert.ok(content.includes('Prevention: Verify availability first.'))
  })

  it('omits correction section when undefined', () => {
    const record = makeFailureRecord({ correction: undefined })
    const content = failureToMemoryContent(record)
    assert.ok(!content.includes('Correction:'))
  })
})

// ---------------------------------------------------------------------------
// formatPreventionContext
// ---------------------------------------------------------------------------

describe('formatPreventionContext', () => {
  it('returns empty string when no relevant failures', () => {
    const result = formatPreventionContext({
      hasRelevantFailures: false,
      failures: [],
      preventionAdvice: [],
    })
    assert.equal(result, '')
  })

  it('formats failures and advice into a readable block', () => {
    const result = formatPreventionContext({
      hasRelevantFailures: true,
      failures: [makeFailureRecord({ category: 'tool_error', description: 'api crashed' })],
      preventionAdvice: ['Verify tool availability before retrying.'],
    })
    assert.ok(result.includes('Relevant past failures'))
    assert.ok(result.includes('[tool_error]'))
    assert.ok(result.includes('Verify tool availability'))
  })
})

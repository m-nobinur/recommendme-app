import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  detectImplicitSignals,
  feedbackRatingToNumeric,
  feedbackRatingToSignalType,
} from './feedback'

describe('learning.feedback', () => {
  it('maps explicit rating to signal + numeric score', () => {
    assert.equal(feedbackRatingToSignalType('up'), 'thumbs_up')
    assert.equal(feedbackRatingToSignalType('down'), 'thumbs_down')
    assert.equal(feedbackRatingToNumeric('up'), 5)
    assert.equal(feedbackRatingToNumeric('down'), 1)
  })

  it('detects task completion from gratitude messages', () => {
    const signals = detectImplicitSignals(
      { id: 'm3', role: 'user', content: 'Thanks, that worked perfectly.' },
      [
        { id: 'm1', role: 'user', content: 'Can you draft an invoice reminder?' },
        { id: 'm2', role: 'assistant', content: 'Done. I prepared the reminder draft.' },
      ]
    )

    assert.equal(signals.length, 1)
    assert.equal(signals[0]?.type, 'task_complete')
    assert.equal(signals[0]?.sourceMessageId, 'm3')
  })

  it('detects rephrase when user repeats same request', () => {
    const signals = detectImplicitSignals(
      { id: 'm4', role: 'user', content: 'Can you send invoice #42 now?' },
      [
        { id: 'm1', role: 'user', content: 'Please send invoice #42 right now.' },
        { id: 'm2', role: 'assistant', content: 'I am preparing the invoice message.' },
      ]
    )

    assert.equal(signals.length, 1)
    assert.equal(signals[0]?.type, 'rephrase')
  })

  it('detects tool retry when rephrase follows an assistant error', () => {
    const signals = detectImplicitSignals(
      { id: 'm4', role: 'user', content: 'Please create invoice 123 for Acme again.' },
      [
        { id: 'm1', role: 'user', content: 'Create invoice 123 for Acme.' },
        { id: 'm2', role: 'assistant', content: 'Error: invoice service failed to respond.' },
      ]
    )

    assert.equal(signals.length, 1)
    assert.equal(signals[0]?.type, 'tool_retry')
  })

  it('detects follow-up questions shortly after assistant response', () => {
    const signals = detectImplicitSignals(
      { id: 'm3', role: 'user', content: 'What total amount will be due?' },
      [
        { id: 'm1', role: 'assistant', content: 'Invoice draft created for Acme.' },
        { id: 'm2', role: 'user', content: 'Looks good' },
      ]
    )

    assert.equal(signals.length, 1)
    assert.equal(signals[0]?.type, 'follow_up_question')
  })
})

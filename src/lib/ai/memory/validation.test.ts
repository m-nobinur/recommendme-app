import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  validateBusinessMemory,
  validateBusinessMemoryType,
  validatePiiForLayer,
} from './validation'

describe('validation', () => {
  it('rejects PII in platform layer memories', () => {
    const result = validatePiiForLayer('Contact me at test@example.com', 'platform')
    assert.equal(result.valid, false)
    assert.equal(result.errors.length > 0, true)
  })

  it('accepts a valid business memory payload', () => {
    const result = validateBusinessMemory({
      content: 'Sarah prefers evening appointments after 5pm.',
      type: 'preference',
      confidence: 0.95,
      importance: 0.8,
      source: 'explicit',
    })
    assert.equal(result.valid, true)
  })

  it('rejects unsupported business memory types', () => {
    const result = validateBusinessMemoryType('unsupported-type')
    assert.equal(result.valid, false)
    assert.equal(result.errors.length > 0, true)
  })
})

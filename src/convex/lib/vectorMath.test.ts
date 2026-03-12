import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cosineSimilarity } from './vectorMath'

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3]
    assert.equal(cosineSimilarity(v, v), 1)
  })

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0]
    const b = [0, 1]
    assert.equal(cosineSimilarity(a, b), 0)
  })

  it('returns -1 for opposite vectors', () => {
    const a = [1, 0]
    const b = [-1, 0]
    assert.ok(Math.abs(cosineSimilarity(a, b) - -1) < 1e-10)
  })

  it('returns 0 for mismatched lengths', () => {
    assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0)
  })

  it('returns 0 for empty vectors', () => {
    assert.equal(cosineSimilarity([], []), 0)
  })

  it('returns 0 for zero vectors', () => {
    assert.equal(cosineSimilarity([0, 0], [0, 0]), 0)
  })

  it('handles high-dimensional vectors correctly', () => {
    const a = Array.from({ length: 100 }, (_, i) => Math.sin(i))
    const b = Array.from({ length: 100 }, (_, i) => Math.cos(i))
    const sim = cosineSimilarity(a, b)
    assert.ok(sim >= -1 && sim <= 1, `Expected [-1, 1], got ${sim}`)
  })

  it('is commutative', () => {
    const a = [3, 4, 5]
    const b = [1, 2, 6]
    assert.equal(cosineSimilarity(a, b), cosineSimilarity(b, a))
  })
})

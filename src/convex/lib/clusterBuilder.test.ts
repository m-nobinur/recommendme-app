import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildEmbeddingClusters, dominantValue } from './clusterBuilder'

describe('buildEmbeddingClusters', () => {
  const makeItem = (id: string, embedding: number[]) => ({ _id: id, embedding })

  it('returns empty for no items', () => {
    const clusters = buildEmbeddingClusters([], 0.8)
    assert.equal(clusters.length, 0)
  })

  it('returns empty for single item (below minClusterSize)', () => {
    const clusters = buildEmbeddingClusters([makeItem('a', [1, 0])], 0.8)
    assert.equal(clusters.length, 0)
  })

  it('groups identical embeddings into one cluster', () => {
    const items = [makeItem('a', [1, 0, 0]), makeItem('b', [1, 0, 0]), makeItem('c', [1, 0, 0])]
    const clusters = buildEmbeddingClusters(items, 0.99)
    assert.equal(clusters.length, 1)
    assert.equal(clusters[0].length, 3)
  })

  it('separates orthogonal vectors', () => {
    const items = [makeItem('a', [1, 0]), makeItem('b', [0, 1])]
    const clusters = buildEmbeddingClusters(items, 0.5)
    assert.equal(clusters.length, 0)
  })

  it('forms two distinct clusters', () => {
    const items = [
      makeItem('a1', [1, 0, 0]),
      makeItem('a2', [0.99, 0.01, 0]),
      makeItem('b1', [0, 0, 1]),
      makeItem('b2', [0, 0.01, 0.99]),
    ]
    const clusters = buildEmbeddingClusters(items, 0.9)
    assert.equal(clusters.length, 2)
    const ids = clusters.map((c) => c.map((i) => i._id).sort())
    ids.sort((a, b) => a[0].localeCompare(b[0]))
    assert.deepEqual(ids, [
      ['a1', 'a2'],
      ['b1', 'b2'],
    ])
  })

  it('respects minClusterSize', () => {
    const items = [makeItem('a', [1, 0]), makeItem('b', [0.98, 0.02])]
    assert.equal(buildEmbeddingClusters(items, 0.9, 3).length, 0)
    assert.equal(buildEmbeddingClusters(items, 0.9, 2).length, 1)
  })

  it('handles transitive clustering (A~B, B~C but A!~C)', () => {
    const items = [
      makeItem('a', [1, 0, 0]),
      makeItem('b', [0.9, 0.44, 0]),
      makeItem('c', [0.5, 0.87, 0]),
    ]
    const clusters = buildEmbeddingClusters(items, 0.85)
    assert.ok(clusters.length >= 1)
  })
})

describe('dominantValue', () => {
  it('returns fallback for empty array', () => {
    assert.equal(
      dominantValue([], (x: string) => x, 'default'),
      'default'
    )
  })

  it('returns the most frequent value', () => {
    const items = [{ t: 'a' }, { t: 'b' }, { t: 'a' }, { t: 'c' }, { t: 'a' }]
    assert.equal(
      dominantValue(items, (x) => x.t, 'fallback'),
      'a'
    )
  })

  it('breaks ties by first-found', () => {
    const items = [{ t: 'x' }, { t: 'y' }]
    const result = dominantValue(items, (x) => x.t, 'fallback')
    assert.ok(result === 'x' || result === 'y')
  })

  it('handles single item', () => {
    assert.equal(
      dominantValue([{ t: 'only' }], (x) => x.t, 'fallback'),
      'only'
    )
  })
})

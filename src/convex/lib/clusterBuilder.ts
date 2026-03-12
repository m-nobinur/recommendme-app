/**
 * Generic Union-Find cluster builder for embedding-based grouping.
 *
 * Used by memoryConsolidation, nicheAggregation, and platformAggregation workers.
 */

import { cosineSimilarity } from './vectorMath'

export interface Embeddable {
  _id: string
  embedding: number[]
}

/**
 * Groups items by pairwise cosine similarity using Union-Find with path compression.
 * Returns only groups with >= minClusterSize members.
 */
export function buildEmbeddingClusters<T extends Embeddable>(
  items: T[],
  threshold: number,
  minClusterSize = 2
): T[][] {
  const parent = new Map<string, string>()

  function find(id: string): string {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root) ?? root
    let current = id
    while (current !== root) {
      const next = parent.get(current) ?? current
      parent.set(current, root)
      current = next
    }
    return root
  }

  function union(a: string, b: string) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const item of items) parent.set(item._id, item._id)

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (cosineSimilarity(items[i].embedding, items[j].embedding) >= threshold) {
        union(items[i]._id, items[j]._id)
      }
    }
  }

  const groups = new Map<string, T[]>()
  for (const item of items) {
    const root = find(item._id)
    const group = groups.get(root) ?? []
    group.push(item)
    groups.set(root, group)
  }

  return Array.from(groups.values()).filter((g) => g.length >= minClusterSize)
}

/**
 * Finds the most frequent value for a given key accessor across items.
 * Returns the fallback when items is empty.
 */
export function dominantValue<T>(items: T[], accessor: (t: T) => string, fallback: string): string {
  const counts = new Map<string, number>()
  for (const item of items) {
    const val = accessor(item)
    counts.set(val, (counts.get(val) ?? 0) + 1)
  }
  let best = fallback
  let max = 0
  for (const [val, count] of counts) {
    if (count > max) {
      best = val
      max = count
    }
  }
  return best
}

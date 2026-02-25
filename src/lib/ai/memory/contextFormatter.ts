/**
 * Context Formatter
 *
 * Transforms selected, scored memories into natural-language context for the
 * system prompt. The output reads like personal knowledge — no internal tags,
 * confidence scores, or system annotations are exposed.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  OUTPUT FORMAT                                                   │
 * │                                                                  │
 * │  ## What You Know                                                │
 * │                                                                  │
 * │  **Important — always follow these:**                            │
 * │  - Sarah's headshots must always be scheduled after 2pm          │
 * │                                                                  │
 * │  **About your clients:**                                         │
 * │  - Sarah Johnson prefers outdoor photoshoots during golden hour  │
 * │  - John Smith was referred by Sarah                              │
 * │                                                                  │
 * │  **Things you've learned:**                                      │
 * │  - Clients who book on Monday tend to reschedule less            │
 * │                                                                  │
 * └──────────────────────────────────────────────────────────────────┘
 */

import type { AgentMemory, BusinessMemory, NicheMemory, PlatformMemory } from '@/types'
import type { ScoredMemory } from './scoring'
import { estimateTokens } from './tokenBudget'

export interface FormattedContext {
  text: string
  memoryIds: string[]
  tokenCount: number
  memoriesUsed: number
}

const MAX_ENTRY_LENGTH = 200
const TRUNCATION_SUFFIX = '...'
const TRUNCATION_LIMIT = MAX_ENTRY_LENGTH - TRUNCATION_SUFFIX.length

const CUSTOMER_INFO_TYPES: readonly string[] = ['fact', 'preference', 'context']

function truncate(content: string): string {
  if (content.length <= MAX_ENTRY_LENGTH) return content
  return content.slice(0, TRUNCATION_LIMIT) + TRUNCATION_SUFFIX
}

function pushEntry(parts: string[], ids: string[], content: string, id: string): void {
  parts.push(`- ${truncate(content)}`)
  ids.push(id)
}

/**
 * Format business memories into natural-language sections.
 * Groups by type in a single pass, then emits sections in priority order.
 */
function formatBusinessMemories(
  memories: Array<ScoredMemory<unknown>>,
  parts: string[],
  ids: string[]
): void {
  if (memories.length === 0) return

  const grouped = new Map<string, Array<ScoredMemory<BusinessMemory>>>()

  for (const memory of memories) {
    const doc = memory.document as BusinessMemory
    const type = doc.type
    let group = grouped.get(type)
    if (!group) {
      group = []
      grouped.set(type, group)
    }
    group.push(memory as ScoredMemory<BusinessMemory>)
  }

  const instructions = grouped.get('instruction')
  if (instructions) {
    parts.push('**Important — always follow these:**')
    for (const mem of instructions) {
      pushEntry(parts, ids, mem.document.content, String(mem.document._id))
    }
    parts.push('')
  }

  const hasCustomerInfo = CUSTOMER_INFO_TYPES.some((t) => grouped.has(t))
  if (hasCustomerInfo) {
    parts.push('**About your clients:**')
    for (const type of CUSTOMER_INFO_TYPES) {
      const group = grouped.get(type)
      if (!group) continue
      for (const mem of group) {
        pushEntry(parts, ids, mem.document.content, String(mem.document._id))
      }
    }
    parts.push('')
  }

  const relationships = grouped.get('relationship')
  if (relationships) {
    parts.push('**Relationships:**')
    for (const mem of relationships) {
      pushEntry(parts, ids, mem.document.content, String(mem.document._id))
    }
    parts.push('')
  }

  const episodic = grouped.get('episodic')
  if (episodic) {
    parts.push('**Recent context:**')
    for (const mem of episodic) {
      pushEntry(parts, ids, mem.document.content, String(mem.document._id))
    }
    parts.push('')
  }
}

function formatAgentMemories(
  memories: Array<ScoredMemory<unknown>>,
  parts: string[],
  ids: string[]
): void {
  if (memories.length === 0) return

  parts.push("**Things you've learned:**")
  for (const memory of memories) {
    const doc = memory.document as AgentMemory
    pushEntry(parts, ids, doc.content, String(doc._id))
  }
  parts.push('')
}

function formatNicheMemories(
  memories: Array<ScoredMemory<unknown>>,
  parts: string[],
  ids: string[]
): void {
  if (memories.length === 0) return

  parts.push('**Industry knowledge:**')
  for (const memory of memories) {
    const doc = memory.document as NicheMemory
    pushEntry(parts, ids, doc.content, String(doc._id))
  }
  parts.push('')
}

function formatPlatformMemories(
  memories: Array<ScoredMemory<unknown>>,
  parts: string[],
  ids: string[]
): void {
  if (memories.length === 0) return

  parts.push('**Best practices:**')
  for (const memory of memories) {
    const doc = memory.document as PlatformMemory
    pushEntry(parts, ids, doc.content, String(doc._id))
  }
  parts.push('')
}

/**
 * Format selected memories into natural-language context text for the system prompt.
 *
 * Ordering priority:
 * 1. Business memories (instructions first, then facts/prefs, relationships, episodic)
 * 2. Agent memories (learned patterns)
 * 3. Niche memories (industry knowledge)
 * 4. Platform memories (best practices)
 */
export function formatContext(selected: {
  platform: Array<ScoredMemory<unknown>>
  niche: Array<ScoredMemory<unknown>>
  business: Array<ScoredMemory<unknown>>
  agent: Array<ScoredMemory<unknown>>
}): FormattedContext {
  const memoriesUsed =
    selected.business.length +
    selected.agent.length +
    selected.niche.length +
    selected.platform.length

  if (memoriesUsed === 0) {
    return { text: '', memoryIds: [], tokenCount: 0, memoriesUsed: 0 }
  }

  const parts: string[] = ['---', '## What You Know', '']
  const allIds: string[] = []

  formatBusinessMemories(selected.business, parts, allIds)
  formatAgentMemories(selected.agent, parts, allIds)
  formatNicheMemories(selected.niche, parts, allIds)
  formatPlatformMemories(selected.platform, parts, allIds)

  parts.push('---')

  const text = parts.join('\n').trim()
  const tokenCount = estimateTokens(text)

  return { text, memoryIds: allIds, tokenCount, memoriesUsed }
}

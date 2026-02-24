/**
 * Context Formatter
 *
 * Transforms selected, scored memories into structured text for the
 * system prompt. Produces human-readable sections with priority ordering,
 * confidence indicators, and memory type annotations.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  OUTPUT FORMAT                                                   │
 * │                                                                  │
 * │  ## Business Rules (HIGH PRIORITY)                               │
 * │  - [instruction] Content here (confidence: 0.95)                 │
 * │                                                                  │
 * │  ## Customer Information                                         │
 * │  - [fact] John prefers mornings (confidence: 0.88)               │
 * │                                                                  │
 * │  ## Learned Patterns                                             │
 * │  - [pattern] Clients who book Monday... (success: 0.75)          │
 * │                                                                  │
 * │  ## Industry Knowledge                                           │
 * │  - [niche] Salon businesses see 30% higher... (confidence: 0.87) │
 * │                                                                  │
 * │  ## Platform Best Practices                                      │
 * │  - [sales] Always follow up within 24h (confidence: 0.90)        │
 * └──────────────────────────────────────────────────────────────────┘
 */

import type { AgentMemory, BusinessMemory, NicheMemory, PlatformMemory } from '@/types'
import type { ScoredMemory } from './scoring'
import { estimateTokens } from './tokenBudget'

// ============================================
// TYPES
// ============================================

export interface FormattedContext {
  text: string
  memoryIds: string[]
  tokenCount: number
  memoriesUsed: number
}

// ============================================
// CONSTANTS
// ============================================

const MAX_ENTRY_LENGTH = 200
const TRUNCATION_SUFFIX = '...'
const TRUNCATION_LIMIT = MAX_ENTRY_LENGTH - TRUNCATION_SUFFIX.length

const CUSTOMER_INFO_TYPES: readonly string[] = ['fact', 'preference', 'context']

// ============================================
// FORMATTING HELPERS
// ============================================

/**
 * Truncate content to maximum length, appending '...' if truncated.
 */
function truncate(content: string): string {
  if (content.length <= MAX_ENTRY_LENGTH) return content
  return content.slice(0, TRUNCATION_LIMIT) + TRUNCATION_SUFFIX
}

/**
 * Append a formatted memory entry to the output parts array and IDs array.
 */
function appendEntry(
  parts: string[],
  ids: string[],
  tag: string,
  content: string,
  metricLabel: string,
  metricValue: number,
  id: string
): void {
  parts.push(`- [${tag}] ${truncate(content)} (${metricLabel}: ${metricValue.toFixed(2)})`)
  ids.push(id)
}

// ============================================
// SECTION FORMATTERS
// ============================================

/**
 * Format business memories into structured sections.
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
    parts.push('## Business Rules (HIGH PRIORITY)')
    for (const mem of instructions) {
      appendEntry(
        parts,
        ids,
        'instruction',
        mem.document.content,
        'confidence',
        mem.document.confidence,
        String(mem.document._id)
      )
    }
    parts.push('')
  }

  const hasCustomerInfo = CUSTOMER_INFO_TYPES.some((t) => grouped.has(t))
  if (hasCustomerInfo) {
    parts.push('## Customer Information')
    for (const type of CUSTOMER_INFO_TYPES) {
      const group = grouped.get(type)
      if (!group) continue
      for (const mem of group) {
        const tag = mem.document.version > 1 ? `${type}, updated` : type
        appendEntry(
          parts,
          ids,
          tag,
          mem.document.content,
          'confidence',
          mem.document.confidence,
          String(mem.document._id)
        )
      }
    }
    parts.push('')
  }

  // Relationships section
  const relationships = grouped.get('relationship')
  if (relationships) {
    parts.push('## Relationships')
    for (const mem of relationships) {
      appendEntry(
        parts,
        ids,
        'relationship',
        mem.document.content,
        'confidence',
        mem.document.confidence,
        String(mem.document._id)
      )
    }
    parts.push('')
  }

  // Episodic section
  const episodic = grouped.get('episodic')
  if (episodic) {
    parts.push('## Recent Context')
    for (const mem of episodic) {
      appendEntry(
        parts,
        ids,
        'episodic',
        mem.document.content,
        'confidence',
        mem.document.confidence,
        String(mem.document._id)
      )
    }
    parts.push('')
  }
}

/**
 * Format agent memories (patterns, successes, etc.).
 */
function formatAgentMemories(
  memories: Array<ScoredMemory<unknown>>,
  parts: string[],
  ids: string[]
): void {
  if (memories.length === 0) return

  parts.push('## Learned Patterns')
  for (const memory of memories) {
    const doc = memory.document as AgentMemory
    appendEntry(parts, ids, doc.category, doc.content, 'success', doc.successRate, String(doc._id))
  }
  parts.push('')
}

/**
 * Format niche memories (industry knowledge).
 */
function formatNicheMemories(
  memories: Array<ScoredMemory<unknown>>,
  parts: string[],
  ids: string[]
): void {
  if (memories.length === 0) return

  parts.push('## Industry Knowledge')
  for (const memory of memories) {
    const doc = memory.document as NicheMemory
    appendEntry(
      parts,
      ids,
      doc.category,
      doc.content,
      'confidence',
      doc.confidence,
      String(doc._id)
    )
  }
  parts.push('')
}

/**
 * Format platform memories (platform-wide best practices).
 */
function formatPlatformMemories(
  memories: Array<ScoredMemory<unknown>>,
  parts: string[],
  ids: string[]
): void {
  if (memories.length === 0) return

  parts.push('## Platform Best Practices')
  for (const memory of memories) {
    const doc = memory.document as PlatformMemory
    appendEntry(
      parts,
      ids,
      doc.category,
      doc.content,
      'confidence',
      doc.confidence,
      String(doc._id)
    )
  }
  parts.push('')
}

/**
 * Format selected memories into structured context text for the system prompt.
 *
 * Ordering priority:
 * 1. Business memories (instructions first, then facts/prefs, relationships, episodic)
 * 2. Agent memories (learned patterns)
 * 3. Niche memories (industry knowledge)
 * 4. Platform memories (best practices)
 *
 * @param selected - Token-budget-selected memories per layer
 * @returns FormattedContext with text, memory IDs, and metadata
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

  const parts: string[] = ['---', '## What You Know (use everything relevant)', '']
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

/**
 * Token Budget Manager
 *
 * Ensures the memory context injected into the system prompt fits
 * within a configurable token limit. Uses greedy selection on scored
 * memories (descending by composite score) and overflow reallocation.
 *
 * Budget is configurable at three levels (highest priority wins):
 *   1. Environment variables (AI_MEMORY_BUDGET_*)
 *   2. Runtime override via `allocateTokenBudget(scored, customConfig)`
 *   3. Hardcoded defaults (fallback)
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  TOKEN BUDGET ALLOCATION (defaults)                              │
 * │                                                                  │
 * │  Section              │ Budget                                   │
 * │  ─────────────────────┼────────                                  │
 * │  Platform             │ 200                                      │
 * │  Niche                │ 300                                      │
 * │  Business             │ 2000                                     │
 * │  Agent                │ 500                                      │
 * │  Relations            │ 500                                      │
 * │  Conversation Summary │ 500                                      │
 * │  ─────────────────────┼────────                                  │
 * │  TOTAL                │ 4000                                     │
 * │                                                                  │
 * │  Overflow: unused budget from lower-priority sections flows to   │
 * │  higher-priority sections (business > agent > niche > platform). │
 * └──────────────────────────────────────────────────────────────────┘
 */

import type { ScoredMemory, ScoredSearchResults } from './scoring'

// ============================================
// TYPES
// ============================================

export interface BudgetAllocation {
  platform: number
  niche: number
  business: number
  agent: number
  relations: number
  conversationSummary: number
}

export interface BudgetUsage {
  allocated: BudgetAllocation
  used: {
    platform: number
    niche: number
    business: number
    agent: number
  }
  totalUsed: number
  totalBudget: number
}

export interface SelectedMemories {
  platform: Array<ScoredMemory<unknown>>
  niche: Array<ScoredMemory<unknown>>
  business: Array<ScoredMemory<unknown>>
  agent: Array<ScoredMemory<unknown>>
  budgetUsage: BudgetUsage
}

/**
 * Configurable token budget settings.
 * All fields are optional — unset fields use defaults.
 */
export interface TokenBudgetConfig {
  /** Total token budget for all memory context */
  totalBudget?: number
  /** Per-layer budgets */
  platform?: number
  niche?: number
  business?: number
  agent?: number
  relations?: number
  conversationSummary?: number
  /** Max surplus tokens to reallocate to a single section */
  maxReallocationPerSection?: number
}

// ============================================
// CONSTANTS (hardcoded defaults)
// ============================================

type LayerKey = 'platform' | 'niche' | 'business' | 'agent'

interface SelectedLayerResults {
  platform: Array<ScoredMemory<unknown>>
  niche: Array<ScoredMemory<unknown>>
  business: Array<ScoredMemory<unknown>>
  agent: Array<ScoredMemory<unknown>>
}

const HARDCODED_DEFAULTS: Required<TokenBudgetConfig> = {
  totalBudget: 4000,
  platform: 200,
  niche: 300,
  business: 2000,
  agent: 500,
  relations: 500,
  conversationSummary: 500,
  maxReallocationPerSection: 500,
}

/**
 * Priority order for overflow reallocation (highest first).
 * Unused budget from lower-priority sections flows to higher ones.
 */
const REALLOCATION_PRIORITY: readonly LayerKey[] = ['business', 'agent', 'niche', 'platform']

// ============================================
// CONFIGURATION RESOLUTION
// ============================================

/** Cached resolved config (env vars read once) */
let resolvedConfig: Required<TokenBudgetConfig> | null = null

/**
 * Parse a numeric env var with bounds checking.
 * Returns undefined if not set or invalid.
 */
function parseEnvInt(name: string, min: number, max: number): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const val = Number.parseInt(raw, 10)
  if (Number.isNaN(val) || val < min || val > max) {
    console.warn(
      `[Reme:TokenBudget] Invalid env ${name}="${raw}", must be ${min}-${max}. Ignoring.`
    )
    return undefined
  }
  return val
}

/**
 * Resolve the effective token budget config.
 *
 * Priority: env vars > hardcoded defaults
 * Cached after first call (env vars don't change at runtime).
 */
function resolveConfig(): Required<TokenBudgetConfig> {
  if (resolvedConfig) return resolvedConfig

  resolvedConfig = {
    totalBudget:
      parseEnvInt('AI_MEMORY_BUDGET_TOTAL', 500, 32000) ?? HARDCODED_DEFAULTS.totalBudget,
    platform: parseEnvInt('AI_MEMORY_BUDGET_PLATFORM', 0, 4000) ?? HARDCODED_DEFAULTS.platform,
    niche: parseEnvInt('AI_MEMORY_BUDGET_NICHE', 0, 4000) ?? HARDCODED_DEFAULTS.niche,
    business: parseEnvInt('AI_MEMORY_BUDGET_BUSINESS', 0, 16000) ?? HARDCODED_DEFAULTS.business,
    agent: parseEnvInt('AI_MEMORY_BUDGET_AGENT', 0, 4000) ?? HARDCODED_DEFAULTS.agent,
    relations: parseEnvInt('AI_MEMORY_BUDGET_RELATIONS', 0, 4000) ?? HARDCODED_DEFAULTS.relations,
    conversationSummary:
      parseEnvInt('AI_MEMORY_BUDGET_CONVERSATION_SUMMARY', 0, 4000) ??
      HARDCODED_DEFAULTS.conversationSummary,
    maxReallocationPerSection:
      parseEnvInt('AI_MEMORY_BUDGET_MAX_REALLOCATION', 0, 4000) ??
      HARDCODED_DEFAULTS.maxReallocationPerSection,
  }

  return resolvedConfig
}

/**
 * Merge runtime override with the resolved base config.
 * Override fields take precedence; unset fields use base.
 */
function mergeConfig(override?: TokenBudgetConfig): Required<TokenBudgetConfig> {
  const base = resolveConfig()
  if (!override) return base

  return {
    totalBudget: override.totalBudget ?? base.totalBudget,
    platform: override.platform ?? base.platform,
    niche: override.niche ?? base.niche,
    business: override.business ?? base.business,
    agent: override.agent ?? base.agent,
    relations: override.relations ?? base.relations,
    conversationSummary: override.conversationSummary ?? base.conversationSummary,
    maxReallocationPerSection: override.maxReallocationPerSection ?? base.maxReallocationPerSection,
  }
}

/**
 * Reset the cached config. Useful for testing or hot-reloading.
 */
export function resetTokenBudgetConfig(): void {
  resolvedConfig = null
}

/**
 * Get the current effective config (for debugging/logging).
 */
export function getTokenBudgetConfig(override?: TokenBudgetConfig): Required<TokenBudgetConfig> {
  return mergeConfig(override)
}

// ============================================
// TOKEN ESTIMATION
// ============================================

/**
 * Approximate token count for a string.
 *
 * Uses the widely accepted ~4 characters per token heuristic for English.
 * Accurate enough for budget management; exact counts are unnecessary
 * since we're operating within a generous buffer.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Get the text content from a memory document.
 * Works across all memory layer types.
 */
function getMemoryContent(doc: Record<string, unknown>): string {
  return (doc.content as string) ?? ''
}

// ============================================
// SELECTION LOGIC
// ============================================

/**
 * Greedy selection: iterate through scored memories descending by score,
 * adding each if it fits within the remaining budget.
 *
 * @returns Selected memories and total tokens consumed
 */
function greedySelect<T>(
  memories: Array<ScoredMemory<T>>,
  budgetTokens: number
): { selected: Array<ScoredMemory<T>>; tokensUsed: number } {
  const selected: Array<ScoredMemory<T>> = []
  let tokensUsed = 0

  for (const memory of memories) {
    const content = getMemoryContent(memory.document as Record<string, unknown>)
    const tokens = estimateTokens(content)

    if (tokensUsed + tokens <= budgetTokens) {
      selected.push(memory)
      tokensUsed += tokens
    }
  }

  return { selected, tokensUsed }
}

/**
 * Enforce a strict global token cap across all selected layers.
 *
 * If combined selected tokens exceed totalBudget, re-select globally
 * by composite score (descending) until the total budget is met.
 */
function enforceTotalBudget(
  selected: SelectedLayerResults,
  totalBudget: number
): { selected: SelectedLayerResults; used: BudgetUsage['used']; totalUsed: number } {
  const perLayerUsed: BudgetUsage['used'] = {
    platform: 0,
    niche: 0,
    business: 0,
    agent: 0,
  }

  if (totalBudget <= 0) {
    return {
      selected: { platform: [], niche: [], business: [], agent: [] },
      used: perLayerUsed,
      totalUsed: 0,
    }
  }

  const flattened = [
    ...selected.platform.map((memory) => ({ layer: 'platform' as const, memory })),
    ...selected.niche.map((memory) => ({ layer: 'niche' as const, memory })),
    ...selected.business.map((memory) => ({ layer: 'business' as const, memory })),
    ...selected.agent.map((memory) => ({ layer: 'agent' as const, memory })),
  ].sort((a, b) => b.memory.compositeScore - a.memory.compositeScore)

  const capped: SelectedLayerResults = {
    platform: [],
    niche: [],
    business: [],
    agent: [],
  }

  let totalUsed = 0

  for (const entry of flattened) {
    const content = getMemoryContent(entry.memory.document as Record<string, unknown>)
    const tokens = estimateTokens(content)

    if (totalUsed + tokens > totalBudget) {
      continue
    }

    capped[entry.layer].push(entry.memory)
    perLayerUsed[entry.layer] += tokens
    totalUsed += tokens
  }

  return {
    selected: capped,
    used: perLayerUsed,
    totalUsed,
  }
}

// ============================================
// MAIN EXPORT
// ============================================

/**
 * Allocate token budget across memory layers and select memories
 * that fit within the budget.
 *
 * Process:
 * 1. Attempt selection for each section with its configured allocation
 * 2. Collect unused budget from each section
 * 3. Redistribute surplus to higher-priority sections that need more
 * 4. Re-select for sections that received additional budget
 *
 * @param scored - Scored and sorted memories from all layers
 * @param budgetOverride - Optional runtime budget override (e.g. from org config)
 * @returns Selected memories per layer with budget usage metadata
 */
export function allocateTokenBudget(
  scored: ScoredSearchResults,
  budgetOverride?: TokenBudgetConfig
): SelectedMemories {
  const config = mergeConfig(budgetOverride)

  const scoredByLayer = new Map<LayerKey, Array<ScoredMemory<unknown>>>([
    ['platform', scored.platform],
    ['niche', scored.niche],
    ['business', scored.business],
    ['agent', scored.agent],
  ])

  const defaultBudgets = new Map<LayerKey, number>([
    ['platform', config.platform],
    ['niche', config.niche],
    ['business', config.business],
    ['agent', config.agent],
  ])

  // Initial selection + surplus calculation in a single iteration
  const initialResults = new Map<
    LayerKey,
    { selected: Array<ScoredMemory<unknown>>; tokensUsed: number }
  >()
  let totalSurplus = 0

  for (const [layer, memories] of scoredByLayer) {
    const budget = defaultBudgets.get(layer) ?? 0
    const result = greedySelect(memories, budget)
    initialResults.set(layer, result)
    totalSurplus += budget - result.tokensUsed
  }

  // Redistribute surplus by priority using Map lookups
  const adjustedBudgets = new Map(defaultBudgets)

  if (totalSurplus > 0) {
    for (const layer of REALLOCATION_PRIORITY) {
      if (totalSurplus <= 0) break

      const initial = initialResults.get(layer)
      const available = scoredByLayer.get(layer)

      // Only reallocate if this section has unselected memories
      if (initial && available && initial.selected.length < available.length) {
        const extraBudget = Math.min(totalSurplus, config.maxReallocationPerSection)
        adjustedBudgets.set(layer, (adjustedBudgets.get(layer) ?? 0) + extraBudget)
        totalSurplus -= extraBudget
      }
    }
  }

  // Re-select for layers that received additional budget
  const finalResults = new Map<
    LayerKey,
    { selected: Array<ScoredMemory<unknown>>; tokensUsed: number }
  >()

  for (const [layer, memories] of scoredByLayer) {
    const adjustedBudget = adjustedBudgets.get(layer) ?? 0
    const defaultBudget = defaultBudgets.get(layer) ?? 0

    finalResults.set(
      layer,
      adjustedBudget > defaultBudget
        ? greedySelect(memories, adjustedBudget)
        : (initialResults.get(layer) ?? { selected: [], tokensUsed: 0 })
    )
  }

  const platformResult = finalResults.get('platform') ?? { selected: [], tokensUsed: 0 }
  const nicheResult = finalResults.get('niche') ?? { selected: [], tokensUsed: 0 }
  const businessResult = finalResults.get('business') ?? { selected: [], tokensUsed: 0 }
  const agentResult = finalResults.get('agent') ?? { selected: [], tokensUsed: 0 }

  const cappedSelection = enforceTotalBudget(
    {
      platform: platformResult.selected,
      niche: nicheResult.selected,
      business: businessResult.selected,
      agent: agentResult.selected,
    },
    config.totalBudget
  )

  return {
    platform: cappedSelection.selected.platform,
    niche: cappedSelection.selected.niche,
    business: cappedSelection.selected.business,
    agent: cappedSelection.selected.agent,
    budgetUsage: {
      allocated: {
        platform: adjustedBudgets.get('platform') ?? config.platform,
        niche: adjustedBudgets.get('niche') ?? config.niche,
        business: adjustedBudgets.get('business') ?? config.business,
        agent: adjustedBudgets.get('agent') ?? config.agent,
        relations: config.relations,
        conversationSummary: config.conversationSummary,
      },
      used: cappedSelection.used,
      totalUsed: cappedSelection.totalUsed,
      totalBudget: config.totalBudget,
    },
  }
}

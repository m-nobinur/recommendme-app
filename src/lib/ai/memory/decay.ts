/**
 * Ebbinghaus-Inspired Decay Algorithm
 *
 * Calculates memory strength over time using an exponential forgetting curve
 * adapted for AI memory management.
 *
 * Formula: strength = e^(-lambda * t / (1 + r))
 *
 *   lambda = base decay rate (varies by memory type)
 *   t      = time since last access (in days)
 *   r      = reinforcement factor (derived from access patterns)
 *
 * Lifecycle thresholds:
 *   Active     (> 0.7)  — full retrieval priority
 *   Accessible (0.3–0.7) — lower priority, access can boost back
 *   Archive    (0.1–0.3) — compress/summarize candidate
 *   Expired    (< 0.1)  — soft-delete candidate
 */

import type { BusinessMemoryType } from '@/types'

export type MemoryLifecycleState = 'active' | 'accessible' | 'archive' | 'expired'

export type DecayableMemoryType = BusinessMemoryType | 'pattern'

const MS_PER_DAY = 86_400_000

const DECAY_RATES: Record<DecayableMemoryType, number> = {
  instruction: 0.01,
  fact: 0.05,
  preference: 0.08,
  pattern: 0.1,
  context: 0.15,
  relationship: 0.08,
  episodic: 0.2,
} as const

const REINFORCEMENT_FACTORS = {
  accessBoost: 0.1,
  successBoost: 0.2,
  correctionPenalty: -0.3,
  explicitRefresh: 1.0,
} as const

const LIFECYCLE_THRESHOLDS = {
  active: 0.7,
  accessible: 0.3,
  archive: 0.1,
} as const

/**
 * Get the base decay rate for a memory type.
 * Unknown types default to 0.10 (medium decay).
 */
export function getBaseDecayRate(memoryType: string): number {
  return DECAY_RATES[memoryType as DecayableMemoryType] ?? 0.1
}

/**
 * Compute the reinforcement factor from access/use metrics.
 *
 * r = (accessCount * accessBoost) + (successRate * successBoost)
 * Clamped to [0, +Infinity) — never negative.
 */
export function computeReinforcement(
  accessCount: number,
  successRate: number = 0,
  wasCorrected: boolean = false
): number {
  let r =
    accessCount * REINFORCEMENT_FACTORS.accessBoost +
    successRate * REINFORCEMENT_FACTORS.successBoost

  if (wasCorrected) {
    r += REINFORCEMENT_FACTORS.correctionPenalty
  }

  return Math.max(0, r)
}

/**
 * Calculate memory strength using the Ebbinghaus-inspired decay formula.
 *
 * @param memoryType - The type of memory (determines base decay rate)
 * @param timeSinceAccessMs - Milliseconds since last access
 * @param reinforcement - Pre-computed reinforcement factor (from computeReinforcement)
 * @returns Decay strength in [0, 1]
 */
export function calculateDecayStrength(
  memoryType: string,
  timeSinceAccessMs: number,
  reinforcement: number
): number {
  if (!Number.isFinite(timeSinceAccessMs) || timeSinceAccessMs <= 0) return 1.0
  if (!Number.isFinite(reinforcement)) reinforcement = 0

  const lambda = getBaseDecayRate(memoryType)
  const tDays = timeSinceAccessMs / MS_PER_DAY
  const safeR = Math.max(0, reinforcement)

  const exponent = (-lambda * tDays) / (1 + safeR)
  const strength = Math.exp(exponent)

  if (!Number.isFinite(strength)) return 0
  return Math.max(0, Math.min(1, strength))
}

/**
 * Determine the lifecycle state from a decay score.
 */
export function getLifecycleState(decayScore: number): MemoryLifecycleState {
  if (decayScore > LIFECYCLE_THRESHOLDS.active) return 'active'
  if (decayScore > LIFECYCLE_THRESHOLDS.accessible) return 'accessible'
  if (decayScore > LIFECYCLE_THRESHOLDS.archive) return 'archive'
  return 'expired'
}

export function shouldArchive(decayScore: number): boolean {
  return decayScore <= LIFECYCLE_THRESHOLDS.accessible && decayScore > LIFECYCLE_THRESHOLDS.archive
}

export function shouldExpire(decayScore: number): boolean {
  return decayScore <= LIFECYCLE_THRESHOLDS.archive
}

export { DECAY_RATES, LIFECYCLE_THRESHOLDS, MS_PER_DAY, REINFORCEMENT_FACTORS }

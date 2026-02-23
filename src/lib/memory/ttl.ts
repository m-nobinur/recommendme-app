/**
 * TTL (Time-To-Live) Management
 *
 * Default expiration windows per memory type, based on the architecture spec:
 *   fact: 180 days | preference: 90 days | instruction: never
 *   context: 30 days | relationship: 180 days | pattern: 365 days | episodic: 90 days
 */

const MS_PER_DAY = 86_400_000

const DEFAULT_TTL_DAYS: Record<string, number | null> = {
  fact: 180,
  preference: 90,
  instruction: null,
  context: 30,
  relationship: 180,
  pattern: 365,
  episodic: 90,
} as const

/**
 * Get the default TTL in milliseconds for a memory type.
 * Returns null for types that never expire (e.g. instruction).
 */
export function getDefaultTTL(memoryType: string): number | null {
  const days = DEFAULT_TTL_DAYS[memoryType]
  if (days === null || days === undefined) return null
  return days * MS_PER_DAY
}

/**
 * Compute the expiration timestamp for a memory.
 * Returns undefined when the type has no TTL (instructions).
 */
export function computeExpiresAt(memoryType: string, createdAt?: number): number | undefined {
  const ttl = getDefaultTTL(memoryType)
  if (ttl === null) return undefined
  return (createdAt ?? Date.now()) + ttl
}

/**
 * Check whether a memory has expired based on its `expiresAt` field.
 */
export function isExpired(memory: { expiresAt?: number | null }): boolean {
  if (memory.expiresAt == null) return false
  return Date.now() > memory.expiresAt
}

/**
 * Check whether a memory is within `thresholdDays` of expiring.
 */
export function isNearExpiry(
  memory: { expiresAt?: number | null },
  thresholdDays: number = 7
): boolean {
  if (memory.expiresAt == null) return false
  return Date.now() > memory.expiresAt - thresholdDays * MS_PER_DAY
}

export { DEFAULT_TTL_DAYS }

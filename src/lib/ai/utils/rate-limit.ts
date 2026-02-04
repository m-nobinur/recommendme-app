interface RateLimitEntry {
  count: number
  resetAt: number
}

/**
 * In-memory rate limit store
 * In production, use Redis or similar distributed cache
 */
const rateLimitStore = new Map<string, RateLimitEntry>()

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  maxRequests: number
  windowMs: number
  keyPrefix?: string
}

/**
 * Default rate limit config
 */
const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60000, // 1 minute
  keyPrefix: 'reme',
}

/**
 * Clean up expired entries periodically
 */
function cleanupExpiredEntries(): void {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key)
    }
  }
}

// Run cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredEntries, 5 * 60 * 1000)
}

/**
 * Check if request is rate limited
 *
 * @param identifier - Unique identifier (e.g., userId, orgId, IP)
 * @param config - Rate limit configuration
 * @returns Object with allowed status and remaining count
 *
 * @example
 * ```ts
 * const { allowed, remaining } = checkRateLimit(userId, {
 *   maxRequests: 50,
 *   windowMs: 60000
 * })
 *
 * if (!allowed) {
 *   throw new Error('Rate limit exceeded')
 * }
 * ```
 */
export function checkRateLimit(
  identifier: string,
  config: Partial<RateLimitConfig> = {}
): { allowed: boolean; remaining: number; resetAt: number } {
  const cfg = { ...DEFAULT_RATE_LIMIT, ...config }
  const key = cfg.keyPrefix ? `${cfg.keyPrefix}:${identifier}` : identifier
  const now = Date.now()

  const entry = rateLimitStore.get(key)

  // No entry or expired - allow and create new
  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + cfg.windowMs,
    })

    return {
      allowed: true,
      remaining: cfg.maxRequests - 1,
      resetAt: now + cfg.windowMs,
    }
  }

  // Check if under limit
  if (entry.count < cfg.maxRequests) {
    entry.count++
    return {
      allowed: true,
      remaining: cfg.maxRequests - entry.count,
      resetAt: entry.resetAt,
    }
  }

  // Rate limit exceeded
  return {
    allowed: false,
    remaining: 0,
    resetAt: entry.resetAt,
  }
}

/**
 * Reset rate limit for an identifier
 * Useful for testing or manual reset
 */
export function resetRateLimit(identifier: string, keyPrefix = 'reme'): void {
  const key = `${keyPrefix}:${identifier}`
  rateLimitStore.delete(key)
}

/**
 * Get current rate limit status without incrementing
 */
export function getRateLimitStatus(
  identifier: string,
  config: Partial<RateLimitConfig> = {}
): { count: number; remaining: number; resetAt: number } | null {
  const cfg = { ...DEFAULT_RATE_LIMIT, ...config }
  const key = cfg.keyPrefix ? `${cfg.keyPrefix}:${identifier}` : identifier
  const now = Date.now()

  const entry = rateLimitStore.get(key)

  if (!entry || entry.resetAt < now) {
    return null
  }

  return {
    count: entry.count,
    remaining: cfg.maxRequests - entry.count,
    resetAt: entry.resetAt,
  }
}

/**
 * Clear all rate limit entries
 * Useful for testing
 */
export function clearRateLimits(): void {
  rateLimitStore.clear()
}

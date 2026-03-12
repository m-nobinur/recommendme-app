import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import type { ConvexHttpClient } from 'convex/browser'
import { RATE_LIMIT, SECURITY_RATE_LIMIT } from '@/lib/constants'

interface RateLimitEntry {
  count: number
  resetAt: number
}

export type SecurityRateLimitScope = 'chat_request' | 'approval_review' | 'feedback_submit'

export interface RateLimitIdentity {
  userId?: string
  organizationId?: string
  ipAddress?: string
}

export interface SecurityRateLimitResult {
  scope: SecurityRateLimitScope
  key: string
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number
  retryAfterSeconds: number
}

export interface SecurityRateLimitOptions {
  maxRequests?: number
  windowMs?: number
  nowMs?: number
  convexClient?: ConvexHttpClient | null
  authToken?: string
}

const rateLimitStore = new Map<string, RateLimitEntry>()
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

const DEFAULT_SCOPE_CONFIG: Record<
  SecurityRateLimitScope,
  { maxRequests: number; windowMs: number }
> = {
  chat_request: {
    maxRequests: parsePositiveIntEnv(
      process.env.AI_SECURITY_CHAT_RATE_LIMIT_PER_MINUTE,
      SECURITY_RATE_LIMIT.CHAT_REQUESTS_PER_MINUTE
    ),
    windowMs: RATE_LIMIT.WINDOW_SECONDS * 1000,
  },
  approval_review: {
    maxRequests: parsePositiveIntEnv(
      process.env.AI_SECURITY_APPROVAL_RATE_LIMIT_PER_MINUTE,
      SECURITY_RATE_LIMIT.APPROVAL_REVIEWS_PER_MINUTE
    ),
    windowMs: RATE_LIMIT.AUTH_WINDOW_SECONDS * 1000,
  },
  feedback_submit: {
    maxRequests: parsePositiveIntEnv(
      process.env.AI_SECURITY_FEEDBACK_RATE_LIMIT_PER_MINUTE,
      SECURITY_RATE_LIMIT.FEEDBACK_SUBMISSIONS_PER_MINUTE
    ),
    windowMs: RATE_LIMIT.WINDOW_SECONDS * 1000,
  },
}

function cleanupExpiredEntries(nowMs: number): void {
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt <= nowMs) {
      rateLimitStore.delete(key)
    }
  }
}

if (typeof setInterval !== 'undefined') {
  setInterval(() => cleanupExpiredEntries(Date.now()), CLEANUP_INTERVAL_MS)
}

function normalizeIpAddress(ipAddress: string): string {
  const first = ipAddress.split(',')[0]?.trim() ?? ''
  return first.toLowerCase()
}

export function resolveRateLimitKey(
  scope: SecurityRateLimitScope,
  identity: RateLimitIdentity
): string {
  if (identity.organizationId && identity.userId) {
    return `${scope}:org:${identity.organizationId}:user:${identity.userId}`
  }
  if (identity.organizationId) {
    return `${scope}:org:${identity.organizationId}`
  }
  if (identity.ipAddress) {
    return `${scope}:ip:${normalizeIpAddress(identity.ipAddress)}`
  }
  return `${scope}:anonymous`
}

export function checkSecurityRateLimit(
  scope: SecurityRateLimitScope,
  identity: RateLimitIdentity,
  options: SecurityRateLimitOptions = {}
): SecurityRateLimitResult {
  const nowMs = options.nowMs ?? Date.now()
  const scopeConfig = DEFAULT_SCOPE_CONFIG[scope]
  const maxRequests = options.maxRequests ?? scopeConfig.maxRequests
  const windowMs = options.windowMs ?? scopeConfig.windowMs
  const key = resolveRateLimitKey(scope, identity)
  const existing = rateLimitStore.get(key)

  if (!existing || existing.resetAt <= nowMs) {
    const resetAt = nowMs + windowMs
    rateLimitStore.set(key, { count: 1, resetAt })
    return {
      scope,
      key,
      allowed: true,
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - 1),
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
    }
  }

  if (existing.count < maxRequests) {
    existing.count += 1
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000))
    return {
      scope,
      key,
      allowed: true,
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - existing.count),
      resetAt: existing.resetAt,
      retryAfterSeconds,
    }
  }

  return {
    scope,
    key,
    allowed: false,
    limit: maxRequests,
    remaining: 0,
    resetAt: existing.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000)),
  }
}

export async function checkSecurityRateLimitDistributed(
  scope: SecurityRateLimitScope,
  identity: RateLimitIdentity,
  options: SecurityRateLimitOptions = {}
): Promise<SecurityRateLimitResult> {
  const nowMs = options.nowMs ?? Date.now()
  const scopeConfig = DEFAULT_SCOPE_CONFIG[scope]
  const maxRequests = options.maxRequests ?? scopeConfig.maxRequests
  const windowMs = options.windowMs ?? scopeConfig.windowMs
  const key = resolveRateLimitKey(scope, identity)

  if (!options.convexClient) {
    return checkSecurityRateLimit(scope, identity, options)
  }

  try {
    return await options.convexClient.mutation(api.security.consumeRateLimit, {
      authToken: options.authToken,
      scope,
      key,
      maxRequests,
      windowMs,
      organizationId: identity.organizationId as Id<'organizations'> | undefined,
      userId: identity.userId as Id<'appUsers'> | undefined,
      ipAddress: identity.ipAddress,
      nowMs,
    })
  } catch (error) {
    console.error('[Reme:Security] Distributed rate limiter unavailable, using local fallback', {
      scope,
      key,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return checkSecurityRateLimit(scope, identity, options)
  }
}

export function clearSecurityRateLimits(): void {
  rateLimitStore.clear()
}

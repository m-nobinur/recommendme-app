import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  checkSecurityRateLimit,
  checkSecurityRateLimitDistributed,
  clearSecurityRateLimits,
  resolveRateLimitKey,
} from './rateLimiting'

describe('security rate limiting key resolution', () => {
  it('uses organization + user when available', () => {
    const key = resolveRateLimitKey('chat_request', {
      organizationId: 'org_1',
      userId: 'user_1',
      ipAddress: '203.0.113.10',
    })
    assert.equal(key, 'chat_request:org:org_1:user:user_1')
  })

  it('falls back to ip and then anonymous', () => {
    const ipKey = resolveRateLimitKey('chat_request', {
      ipAddress: '203.0.113.10',
    })
    const anonKey = resolveRateLimitKey('chat_request', {})
    assert.equal(ipKey, 'chat_request:ip:203.0.113.10')
    assert.equal(anonKey, 'chat_request:anonymous')
  })
})

describe('security rate limiting checks', () => {
  it('blocks after max requests in window', () => {
    clearSecurityRateLimits()

    const first = checkSecurityRateLimit(
      'approval_review',
      { organizationId: 'org_1', userId: 'user_1' },
      { maxRequests: 2, windowMs: 60_000, nowMs: 1_700_000_000_000 }
    )
    const second = checkSecurityRateLimit(
      'approval_review',
      { organizationId: 'org_1', userId: 'user_1' },
      { maxRequests: 2, windowMs: 60_000, nowMs: 1_700_000_000_100 }
    )
    const third = checkSecurityRateLimit(
      'approval_review',
      { organizationId: 'org_1', userId: 'user_1' },
      { maxRequests: 2, windowMs: 60_000, nowMs: 1_700_000_000_200 }
    )

    assert.equal(first.allowed, true)
    assert.equal(second.allowed, true)
    assert.equal(third.allowed, false)
    assert.ok(third.retryAfterSeconds >= 1)
  })

  it('uses distributed limiter when convex client is available', async () => {
    clearSecurityRateLimits()

    const result = await checkSecurityRateLimitDistributed(
      'chat_request',
      { organizationId: 'org_1', userId: 'user_1' },
      {
        convexClient: {
          mutation: async () => ({
            scope: 'chat_request',
            key: 'chat_request:org:org_1:user:user_1',
            allowed: false,
            limit: 60,
            remaining: 0,
            resetAt: 1_700_000_060_000,
            retryAfterSeconds: 45,
          }),
        } as any,
      }
    )

    assert.equal(result.allowed, false)
    assert.equal(result.retryAfterSeconds, 45)
  })
})

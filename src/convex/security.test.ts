import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { consumeRateLimit, purgeExpiredRateLimits } from './security'

describe('security.consumeRateLimit', () => {
  it('inserts a fresh window on first request', async () => {
    const inserts: Array<Record<string, unknown>> = []
    const rows: Array<Record<string, unknown>> = []

    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            take: async () => rows,
          }),
        }),
        insert: async (_table: string, value: Record<string, unknown>) => {
          inserts.push(value)
          return 'rate_limit_1'
        },
        patch: async () => null,
        delete: async () => null,
      },
    }

    const previousBypass = process.env.DISABLE_AUTH_IN_DEV
    process.env.DISABLE_AUTH_IN_DEV = 'true'
    try {
      const result = await (consumeRateLimit as any)._handler(ctx, {
        authToken: undefined,
        scope: 'chat_request',
        key: 'chat_request:org:org_1:user:user_1',
        maxRequests: 2,
        windowMs: 60_000,
        organizationId: 'org_1',
        userId: 'user_1',
        nowMs: 1_700_000_000_000,
      })

      assert.equal(result.allowed, true)
      assert.equal(result.remaining, 1)
      assert.equal(inserts.length, 1)
      assert.equal(inserts[0].count, 1)
    } finally {
      process.env.DISABLE_AUTH_IN_DEV = previousBypass
    }
  })

  it('blocks when request count already reached max', async () => {
    const rows = [
      {
        _id: 'rl_1',
        count: 2,
        resetAt: 1_700_000_060_000,
        updatedAt: 1_700_000_000_000,
      },
    ]

    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            take: async () => rows,
          }),
        }),
        insert: async () => null,
        patch: async () => null,
        delete: async () => null,
      },
    }

    const previousBypass = process.env.DISABLE_AUTH_IN_DEV
    process.env.DISABLE_AUTH_IN_DEV = 'true'
    try {
      const result = await (consumeRateLimit as any)._handler(ctx, {
        authToken: undefined,
        scope: 'approval_review',
        key: 'approval_review:org:org_1:user:user_1',
        maxRequests: 2,
        windowMs: 60_000,
        organizationId: 'org_1',
        userId: 'user_1',
        nowMs: 1_700_000_030_000,
      })

      assert.equal(result.allowed, false)
      assert.equal(result.remaining, 0)
      assert.ok(result.retryAfterSeconds >= 1)
    } finally {
      process.env.DISABLE_AUTH_IN_DEV = previousBypass
    }
  })
})

describe('security.purgeExpiredRateLimits', () => {
  it('deletes expired rows in batch', async () => {
    const deleted: string[] = []
    const expiredRows = [{ _id: 'rl_1' }, { _id: 'rl_2' }]
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            take: async () => expiredRows,
          }),
        }),
        delete: async (id: string) => {
          deleted.push(id)
          return null
        },
      },
    }

    const result = await (purgeExpiredRateLimits as any)._handler(ctx, {
      nowMs: 1_700_000_100_000,
      limit: 10,
    })

    assert.equal(result.deleted, 2)
    assert.deepEqual(deleted, ['rl_1', 'rl_2'])
  })
})

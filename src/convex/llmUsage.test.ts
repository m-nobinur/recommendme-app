import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getOrgBudgetStatus, getOrgUsage, purgeOldUsage } from './llmUsage'

describe('llmUsage.getOrgUsage', () => {
  it('uses sinceMs directly in index bounds', async () => {
    const sinceMs = 1_700_000_000_000
    let gteValue: number | undefined

    const ctx = {
      db: {
        get: async () => ({ _id: 'user_1', organizationId: 'org_1' }),
        query: () => ({
          withIndex: (_name: string, build: (q: any) => unknown) => {
            const chain = {
              eq: () => chain,
              gte: (_field: string, value: number) => {
                gteValue = value
                return chain
              },
            }
            build(chain)
            return {
              order: () => ({
                take: async () => [],
              }),
            }
          },
        }),
      },
    }

    await (getOrgUsage as any)._handler(ctx, {
      organizationId: 'org_1',
      sinceMs,
      limit: 10,
    })

    assert.equal(gteValue, sinceMs)
  })
})

describe('llmUsage.getOrgBudgetStatus', () => {
  it('uses caller-provided nowMs and returns truncation metadata', async () => {
    const nowMs = 1_700_000_000_000
    const rows = [
      {
        createdAt: nowMs - 1_000,
        totalTokens: 100,
        estimatedCostUsd: 0.001,
      },
      {
        createdAt: nowMs - 2_000,
        totalTokens: 200,
        estimatedCostUsd: 0.002,
      },
    ]

    const ctx = {
      db: {
        get: async () => ({ _id: 'user_1', organizationId: 'org_1' }),
        query: () => ({
          withIndex: () => ({
            order: () => ({
              take: async () => rows,
            }),
          }),
        }),
      },
    }

    const result = await (getOrgBudgetStatus as any)._handler(ctx, {
      organizationId: 'org_1',
      dailyLimitTokens: 1_000,
      monthlyLimitTokens: 10_000,
      nowMs,
      maxRows: 2,
    })

    assert.equal(result.daily.tokensUsed, 300)
    assert.equal(result.monthly.tokensUsed, 300)
    assert.equal(result.truncated, true)
  })
})

describe('llmUsage.purgeOldUsage', () => {
  it('schedules follow-up purge when batch is full', async () => {
    const deleted: string[] = []
    const scheduled: Array<{ retentionDays: number }> = []
    const oldRows = Array.from({ length: 500 }, (_, i) => ({ _id: `usage_${i}` }))

    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            take: async () => oldRows,
          }),
        }),
        delete: async (id: string) => {
          deleted.push(id)
        },
      },
      scheduler: {
        runAfter: async (_delay: number, _fn: unknown, payload: { retentionDays: number }) => {
          scheduled.push(payload)
        },
      },
    }

    const result = await (purgeOldUsage as any)._handler(ctx, { retentionDays: 14 })
    assert.equal(result.deleted, 500)
    assert.equal(result.hasMore, true)
    assert.equal(deleted.length, 500)
    assert.equal(scheduled.length, 1)
    assert.equal(scheduled[0].retentionDays, 14)
  })
})

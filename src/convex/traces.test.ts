import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { listByOrg, listByTrace, purgeOldTraces } from './traces'

describe('traces.listByTrace', () => {
  it('requires org membership and queries by organization + trace id', async () => {
    let indexName = ''
    let traceFilter: string | undefined
    let orgFilter: string | undefined
    let requestedLimit = 0

    const ctx = {
      db: {
        get: async () => ({ _id: 'user_1', organizationId: 'org_1' }),
        query: () => ({
          withIndex: (name: string, build: (q: any) => unknown) => {
            indexName = name
            const chain = {
              eq: (field: string, value: string) => {
                if (field === 'organizationId') orgFilter = value
                if (field === 'traceId') traceFilter = value
                return chain
              },
            }
            build(chain)
            return {
              order: () => ({
                take: async (limit: number) => {
                  requestedLimit = limit
                  return [{ _id: 'span_1' }]
                },
              }),
            }
          },
        }),
      },
    }

    const rows = await (listByTrace as any)._handler(ctx, {
      traceId: 'trace_1',
      organizationId: 'org_1',
      limit: 25,
    })

    assert.equal(indexName, 'by_org_trace_start')
    assert.equal(orgFilter, 'org_1')
    assert.equal(traceFilter, 'trace_1')
    assert.equal(requestedLimit, 25)
    assert.equal(rows.length, 1)
  })
})

describe('traces.listByOrg', () => {
  it('uses org+spanType index when spanType filter is provided', async () => {
    let indexName = ''
    const ctx = {
      db: {
        get: async () => ({ _id: 'user_1', organizationId: 'org_1' }),
        query: () => ({
          withIndex: (name: string, _build: (q: any) => unknown) => {
            indexName = name
            return {
              order: () => ({
                take: async () => [],
              }),
            }
          },
        }),
      },
    }

    await (listByOrg as any)._handler(ctx, {
      organizationId: 'org_1',
      spanType: 'llm',
      limit: 10,
    })

    assert.equal(indexName, 'by_org_span_type_created')
  })
})

describe('traces.purgeOldTraces', () => {
  it('schedules follow-up purge when batch is full', async () => {
    const deleted: string[] = []
    const scheduled: Array<{ retentionDays: number }> = []
    const oldRows = Array.from({ length: 500 }, (_, i) => ({ _id: `trace_${i}` }))

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

    const result = await (purgeOldTraces as any)._handler(ctx, { retentionDays: 7 })
    assert.equal(result.deleted, 500)
    assert.equal(result.hasMore, true)
    assert.equal(deleted.length, 500)
    assert.equal(scheduled.length, 1)
    assert.equal(scheduled[0].retentionDays, 7)
  })
})

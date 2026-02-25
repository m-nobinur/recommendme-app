import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { complete, createIfNotRunning, fail } from './agentExecutions'

type RecordValue = Record<string, unknown>

interface QueryState {
  filters: Record<string, unknown>
  sortDesc: boolean
}

function createMockCtx(initial?: {
  executions?: RecordValue[]
  locks?: RecordValue[]
  onInsert?: (table: string, record: RecordValue) => void
}) {
  const executions = [...(initial?.executions ?? [])]
  const locks = [...(initial?.locks ?? [])]

  let idCounter = 0
  const nextId = (prefix: string) => `${prefix}_${++idCounter}`

  const applyFilters = (rows: RecordValue[], state: QueryState) =>
    rows.filter((row) => Object.entries(state.filters).every(([key, value]) => row[key] === value))

  const applySort = (rows: RecordValue[], state: QueryState) => {
    if (!state.sortDesc) return rows
    return [...rows].sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
  }

  const db = {
    query: (table: string) => {
      const state: QueryState = { filters: {}, sortDesc: false }
      const rows = () => (table === 'agentExecutions' ? executions : locks)

      const builder = {
        withIndex: (
          _index: string,
          callback: (q: { eq: (key: string, value: unknown) => unknown }) => unknown
        ) => {
          const queryBuilder = {
            eq: (key: string, value: unknown) => {
              state.filters[key] = value
              return queryBuilder
            },
          }
          callback(queryBuilder)
          return builder
        },
        order: (direction: 'asc' | 'desc') => {
          state.sortDesc = direction === 'desc'
          return builder
        },
        first: async () => {
          const filtered = applySort(applyFilters(rows(), state), state)
          return filtered[0] ?? null
        },
        take: async (count: number) => {
          const filtered = applySort(applyFilters(rows(), state), state)
          return filtered.slice(0, count)
        },
        collect: async () => {
          return applySort(applyFilters(rows(), state), state)
        },
      }

      return builder
    },
    insert: async (table: string, value: RecordValue) => {
      const id = nextId(table === 'agentExecutions' ? 'exec' : 'lock')
      const record = { _id: id, ...value }
      if (table === 'agentExecutions') executions.push(record)
      if (table === 'agentExecutionLocks') {
        locks.push(record)
        initial?.onInsert?.(table, record)
      }
      return id
    },
    get: async (id: string) => {
      return [...executions, ...locks].find((row) => row._id === id) ?? null
    },
    patch: async (id: string, updates: RecordValue) => {
      const list = executions.find((row) => row._id === id)
        ? executions
        : locks.find((row) => row._id === id)
          ? locks
          : null
      if (!list) return
      const index = list.findIndex((row) => row._id === id)
      if (index >= 0) {
        list[index] = { ...list[index], ...updates }
      }
    },
    delete: async (id: string) => {
      const execIndex = executions.findIndex((row) => row._id === id)
      if (execIndex >= 0) {
        executions.splice(execIndex, 1)
        return
      }
      const lockIndex = locks.findIndex((row) => row._id === id)
      if (lockIndex >= 0) {
        locks.splice(lockIndex, 1)
      }
    },
  }

  return {
    db,
    state: { executions, locks },
  }
}

describe('agentExecutions lifecycle', () => {
  it('createIfNotRunning creates execution and lock when none exists', async () => {
    const ctx = createMockCtx()

    const result = await (createIfNotRunning as any)._handler(ctx, {
      organizationId: 'org_1',
      agentType: 'followup',
      triggerType: 'cron',
      triggerId: 'daily',
    })

    assert.equal(result.skipped, false)
    assert.equal(ctx.state.executions.length, 1)
    assert.equal(ctx.state.locks.length, 1)
    assert.equal(ctx.state.executions[0].status, 'pending')
    assert.equal(ctx.state.locks[0].executionId, result.executionId)
  })

  it('createIfNotRunning skips when non-expired lock exists', async () => {
    const now = Date.now()
    const ctx = createMockCtx({
      locks: [
        {
          _id: 'lock_1',
          organizationId: 'org_1',
          agentType: 'followup',
          executionId: 'exec_existing',
          acquiredAt: now - 1000,
          expiresAt: now + 60_000,
        },
      ],
    })

    const result = await (createIfNotRunning as any)._handler(ctx, {
      organizationId: 'org_1',
      agentType: 'followup',
      triggerType: 'cron',
    })

    assert.equal(result.skipped, true)
    assert.equal(result.reason, 'already_running')
    assert.equal(result.executionId, 'exec_existing')
    assert.equal(ctx.state.executions.length, 0)
  })

  it('createIfNotRunning removes expired lock then creates new execution', async () => {
    const now = Date.now()
    const ctx = createMockCtx({
      locks: [
        {
          _id: 'lock_expired',
          organizationId: 'org_1',
          agentType: 'followup',
          executionId: 'exec_old',
          acquiredAt: now - 100_000,
          expiresAt: now - 1,
        },
      ],
    })

    const result = await (createIfNotRunning as any)._handler(ctx, {
      organizationId: 'org_1',
      agentType: 'followup',
      triggerType: 'cron',
    })

    assert.equal(result.skipped, false)
    assert.equal(ctx.state.executions.length, 1)
    assert.equal(ctx.state.locks.length, 1)
    assert.notEqual(ctx.state.locks[0]._id, 'lock_expired')
  })

  it('complete updates execution and releases matching lock', async () => {
    const startedAt = Date.now() - 5_000
    const ctx = createMockCtx({
      executions: [
        {
          _id: 'exec_1',
          organizationId: 'org_1',
          agentType: 'followup',
          status: 'executing',
          startedAt,
          createdAt: startedAt,
        },
      ],
      locks: [
        {
          _id: 'lock_1',
          organizationId: 'org_1',
          agentType: 'followup',
          executionId: 'exec_1',
          acquiredAt: startedAt,
          expiresAt: Date.now() + 60_000,
        },
      ],
    })

    await (complete as any)._handler(ctx, {
      id: 'exec_1',
      status: 'completed',
      actionsPlanned: 2,
      actionsExecuted: 2,
      actionsSkipped: 0,
    })

    assert.equal(ctx.state.locks.length, 0)
    const updated = ctx.state.executions[0]
    assert.equal(updated.status, 'completed')
    assert.equal(updated.actionsExecuted, 2)
    assert.equal(typeof updated.completedAt, 'number')
    assert.equal(typeof updated.durationMs, 'number')
  })

  it('fail marks execution failed and keeps unrelated lock untouched', async () => {
    const startedAt = Date.now() - 4_000
    const ctx = createMockCtx({
      executions: [
        {
          _id: 'exec_1',
          organizationId: 'org_1',
          agentType: 'followup',
          status: 'executing',
          startedAt,
          createdAt: startedAt,
        },
      ],
      locks: [
        {
          _id: 'lock_other',
          organizationId: 'org_1',
          agentType: 'followup',
          executionId: 'exec_other',
          acquiredAt: startedAt,
          expiresAt: Date.now() + 60_000,
        },
      ],
    })

    await (fail as any)._handler(ctx, {
      id: 'exec_1',
      error: 'boom',
    })

    assert.equal(ctx.state.locks.length, 1)
    assert.equal(ctx.state.locks[0]._id, 'lock_other')
    const updated = ctx.state.executions[0]
    assert.equal(updated.status, 'failed')
    assert.equal(updated.error, 'boom')
    assert.equal(typeof updated.completedAt, 'number')
    assert.equal(typeof updated.durationMs, 'number')
  })

  it('createIfNotRunning yields to earlier competing lock', async () => {
    const now = Date.now()
    let lockInserted = false

    const ctx = createMockCtx({
      onInsert: (table) => {
        if (table === 'agentExecutionLocks' && !lockInserted) {
          lockInserted = true
          ctx.state.locks.push({
            _id: 'lock_competitor',
            organizationId: 'org_1',
            agentType: 'followup',
            executionId: 'exec_competitor',
            acquiredAt: now - 100,
            expiresAt: now + 60_000,
          })
        }
      },
    })

    const result = await (createIfNotRunning as any)._handler(ctx, {
      organizationId: 'org_1',
      agentType: 'followup',
      triggerType: 'cron',
    })

    assert.equal(result.skipped, true)
    assert.equal(result.reason, 'already_running')
    assert.equal(result.executionId, 'exec_competitor')

    const skippedExec = ctx.state.executions[0]
    assert.equal(skippedExec.status, 'skipped')
    assert.equal(skippedExec.error, 'Skipped due to concurrent execution lock contention')

    assert.equal(ctx.state.locks.length, 1)
    assert.equal(ctx.state.locks[0]._id, 'lock_competitor')
  })

  it('createIfNotRunning wins when it has the earliest competing lock', async () => {
    const now = Date.now()
    let lockInserted = false

    const ctx = createMockCtx({
      onInsert: (table) => {
        if (table === 'agentExecutionLocks' && !lockInserted) {
          lockInserted = true
          ctx.state.locks.push({
            _id: 'lock_later',
            organizationId: 'org_1',
            agentType: 'followup',
            executionId: 'exec_later',
            acquiredAt: now + 100,
            expiresAt: now + 120_000,
          })
        }
      },
    })

    const result = await (createIfNotRunning as any)._handler(ctx, {
      organizationId: 'org_1',
      agentType: 'followup',
      triggerType: 'cron',
    })

    assert.equal(result.skipped, false)
    assert.equal(result.reason, null)
    assert.ok(result.executionId)

    assert.equal(ctx.state.executions.length, 1)
    assert.equal(ctx.state.executions[0].status, 'pending')
  })
})

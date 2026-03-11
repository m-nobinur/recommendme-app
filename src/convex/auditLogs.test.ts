import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { append, appendBatch, list, recordSecurityEvent } from './auditLogs'

function makeInsertCtx() {
  const inserted: Array<Record<string, unknown>> = []
  const ctx = {
    db: {
      insert: async (_table: string, doc: Record<string, unknown>) => {
        inserted.push(doc)
        return `audit_${inserted.length}`
      },
    },
  }
  return { ctx, inserted }
}

describe('auditLogs.append', () => {
  it('inserts a single audit log with createdAt timestamp', async () => {
    const { ctx, inserted } = makeInsertCtx()

    const id = await (append as any)._handler(ctx, {
      organizationId: 'org_1',
      userId: 'user_1',
      actorType: 'user',
      action: 'lead_updated',
      resourceType: 'lead',
      resourceId: 'lead_1',
      details: { field: 'status', newValue: 'Qualified' },
      riskLevel: 'low',
      traceId: 'trace_abc',
    })

    assert.equal(typeof id, 'string')
    assert.equal(inserted.length, 1)
    assert.equal(inserted[0].organizationId, 'org_1')
    assert.equal(inserted[0].action, 'lead_updated')
    assert.equal(inserted[0].riskLevel, 'low')
    assert.equal(typeof inserted[0].createdAt, 'number')
  })

  it('allows optional fields to be omitted', async () => {
    const { ctx, inserted } = makeInsertCtx()

    await (append as any)._handler(ctx, {
      organizationId: 'org_1',
      actorType: 'system',
      action: 'cron_ran',
      resourceType: 'agentExecution',
      details: {},
      riskLevel: 'low',
    })

    assert.equal(inserted.length, 1)
    assert.equal(inserted[0].userId, undefined)
    assert.equal(inserted[0].resourceId, undefined)
    assert.equal(inserted[0].traceId, undefined)
    assert.equal(inserted[0].ipAddress, undefined)
  })
})

describe('auditLogs.appendBatch', () => {
  it('inserts multiple logs with the same createdAt', async () => {
    const { ctx, inserted } = makeInsertCtx()

    const ids = await (appendBatch as any)._handler(ctx, {
      logs: [
        {
          organizationId: 'org_1',
          actorType: 'agent',
          action: 'agent_action_rejected_by_policy',
          resourceType: 'agentExecution',
          resourceId: 'exec_1',
          details: { reason: 'not allowed' },
          riskLevel: 'high',
        },
        {
          organizationId: 'org_1',
          actorType: 'agent',
          action: 'agent_action_queued_for_approval',
          resourceType: 'approvalQueue',
          resourceId: 'q_1',
          details: { reason: 'needs review' },
          riskLevel: 'medium',
        },
      ],
    })

    assert.equal(ids.length, 2)
    assert.equal(inserted.length, 2)
    assert.equal(inserted[0].createdAt, inserted[1].createdAt)
    assert.equal(inserted[0].action, 'agent_action_rejected_by_policy')
    assert.equal(inserted[1].action, 'agent_action_queued_for_approval')
  })

  it('handles empty batch', async () => {
    const { ctx, inserted } = makeInsertCtx()
    const ids = await (appendBatch as any)._handler(ctx, { logs: [] })

    assert.equal(ids.length, 0)
    assert.equal(inserted.length, 0)
  })
})

describe('auditLogs.recordSecurityEvent', () => {
  it('writes a security_event audit log row', async () => {
    const { ctx, inserted } = makeInsertCtx()
    const ctxWithTokenCheck = {
      ...ctx,
    }
    const previousBypass = process.env.DISABLE_AUTH_IN_DEV
    process.env.DISABLE_AUTH_IN_DEV = 'true'

    try {
      const id = await (recordSecurityEvent as any)._handler(ctxWithTokenCheck, {
        authToken: undefined,
        organizationId: 'org_1',
        userId: 'user_1',
        action: 'chat.rate_limited',
        details: { scope: 'chat_request' },
        riskLevel: 'medium',
        traceId: 'trace_1',
        ipAddress: '203.0.113.10',
      })

      assert.equal(typeof id, 'string')
      assert.equal(inserted.length, 1)
      assert.equal(inserted[0].resourceType, 'security_event')
      assert.equal(inserted[0].action, 'chat.rate_limited')
      assert.equal(inserted[0].riskLevel, 'medium')
    } finally {
      process.env.DISABLE_AUTH_IN_DEV = previousBypass
    }
  })
})

describe('auditLogs.list', () => {
  const allLogs = [
    {
      _id: 'log_1',
      organizationId: 'org_1',
      action: 'lead_updated',
      riskLevel: 'low',
      createdAt: 3,
    },
    {
      _id: 'log_2',
      organizationId: 'org_1',
      action: 'agent_execution_completed',
      riskLevel: 'high',
      createdAt: 2,
    },
    {
      _id: 'log_3',
      organizationId: 'org_1',
      action: 'lead_updated',
      riskLevel: 'medium',
      createdAt: 1,
    },
  ]

  function makeListCtx(indexResults: Record<string, unknown[]>) {
    return {
      db: {
        get: async (id: string) => {
          if (id === 'user_1') return { _id: 'user_1', organizationId: 'org_1', role: 'owner' }
          return null
        },
        query: () => ({
          withIndex: (indexName: string) => ({
            order: () => ({
              take: async (n: number) => (indexResults[indexName] ?? allLogs).slice(0, n),
            }),
          }),
        }),
      },
    }
  }

  it('lists all logs by org when no filters applied', async () => {
    const ctx = makeListCtx({ by_org_created: allLogs })
    const result = await (list as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
    })

    assert.equal(result.length, 3)
  })

  it('filters by action name', async () => {
    const actionLogs = allLogs.filter((l) => l.action === 'lead_updated')
    const ctx = makeListCtx({ by_org_action_created: actionLogs })
    const result = await (list as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      action: 'lead_updated',
    })

    assert.equal(result.length, 2)
    assert.ok(result.every((r: any) => r.action === 'lead_updated'))
  })

  it('filters by risk level', async () => {
    const highRiskLogs = allLogs.filter((l) => l.riskLevel === 'high')
    const ctx = makeListCtx({ by_org_risk_created: highRiskLogs })
    const result = await (list as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      riskLevel: 'high',
    })

    assert.equal(result.length, 1)
    assert.equal(result[0].riskLevel, 'high')
  })

  it('filters by action + risk level', async () => {
    const actionLogs = allLogs.filter((l) => l.action === 'lead_updated')
    const ctx = makeListCtx({ by_org_action_created: actionLogs })
    const result = await (list as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      action: 'lead_updated',
      riskLevel: 'medium',
    })

    assert.equal(result.length, 1)
    assert.equal(result[0].riskLevel, 'medium')
  })

  it('enforces org membership', async () => {
    const ctx = makeListCtx({})
    await assert.rejects(
      () =>
        (list as any)._handler(ctx, {
          userId: 'user_unknown',
          organizationId: 'org_1',
        }),
      /Access denied/
    )
  })

  it('respects limit parameter', async () => {
    const ctx = makeListCtx({ by_org_created: allLogs })
    const result = await (list as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      limit: 1,
    })

    assert.equal(result.length, 1)
  })
})

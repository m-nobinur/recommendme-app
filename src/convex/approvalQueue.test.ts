import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  claimApprovedForExecution,
  enqueueBatch,
  expireStalePending,
  listByStatus,
  listPending,
  recordExecutionAttemptFailure,
  review,
} from './approvalQueue'

describe('approvalQueue.enqueueBatch', () => {
  it('assigns expiration windows based on risk level', async () => {
    const inserted: Array<Record<string, unknown>> = []
    const originalNow = Date.now
    Date.now = () => 1_700_000_000_000

    try {
      const ctx = {
        db: {
          insert: async (_table: string, doc: Record<string, unknown>) => {
            inserted.push(doc)
            return `approval_${inserted.length}`
          },
        },
      }

      const ids = await (enqueueBatch as any)._handler(ctx, {
        organizationId: 'org_1',
        executionId: 'exec_1',
        agentType: 'sales',
        context: 'context',
        actions: [
          {
            action: 'update_lead_status',
            target: 'lead_1',
            actionParams: { status: 'Qualified' },
            riskLevel: 'medium',
            description: 'Medium risk action',
          },
          {
            action: 'delete_lead',
            target: 'lead_2',
            actionParams: {},
            riskLevel: 'high',
            description: 'High risk action',
          },
          {
            action: 'bulkDelete',
            target: 'lead_3',
            actionParams: {},
            riskLevel: 'critical',
            description: 'Critical risk action',
          },
        ],
      })

      assert.equal(ids.length, 3)
      assert.equal(inserted[0].expiresAt, 1_700_086_400_000) // +24h
      assert.equal(inserted[1].expiresAt, 1_700_014_400_000) // +4h
      assert.equal(inserted[2].expiresAt, 1_700_003_600_000) // +1h
      assert.equal(inserted[0].status, 'pending')
    } finally {
      Date.now = originalNow
    }
  })
})

describe('approvalQueue.review', () => {
  it('blocks non-admin reviewers', async () => {
    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === 'user_1') return { _id: 'user_1', organizationId: 'org_1', role: 'member' }
          if (id === 'approval_1')
            return {
              _id: 'approval_1',
              organizationId: 'org_1',
              status: 'pending',
              expiresAt: Date.now() + 1000,
            }
          return null
        },
      },
      scheduler: {
        runAfter: async () => {},
      },
    }

    await assert.rejects(
      () =>
        (review as any)._handler(ctx, {
          userId: 'user_1',
          organizationId: 'org_1',
          id: 'approval_1',
          decision: 'approve',
        }),
      /owners\/admins/
    )
  })

  it('approves pending items for admins', async () => {
    const patches: Array<Record<string, unknown>> = []
    const auditLogs: Array<Record<string, unknown>> = []
    const scheduledPayloads: Array<Record<string, unknown>> = []
    const now = Date.now()

    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === 'user_1') return { _id: 'user_1', organizationId: 'org_1', role: 'owner' }
          if (id === 'approval_1')
            return {
              _id: 'approval_1',
              organizationId: 'org_1',
              status: 'pending',
              expiresAt: now + 60_000,
            }
          return null
        },
        patch: async (_id: string, patch: Record<string, unknown>) => {
          patches.push(patch)
        },
        insert: async (_table: string, value: Record<string, unknown>) => {
          auditLogs.push(value)
          return 'audit_1'
        },
      },
      scheduler: {
        runAfter: async (_delay: number, _fnRef: unknown, payload: Record<string, unknown>) => {
          scheduledPayloads.push(payload)
        },
      },
    }

    const result = await (review as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      id: 'approval_1',
      decision: 'approve',
    })

    assert.equal(result.status, 'approved')
    assert.equal(patches.length, 1)
    assert.equal(patches[0].status, 'approved')
    assert.equal(patches[0].reviewedBy, 'user_1')
    assert.equal(auditLogs.length, 1)
    assert.equal(auditLogs[0].action, 'approval_review_approved')
    assert.equal(scheduledPayloads.length, 1)
    assert.equal(scheduledPayloads[0].approvalId, 'approval_1')
  })

  it('reconciles execution after rejection', async () => {
    const scheduledPayloads: Array<Record<string, unknown>> = []
    const now = Date.now()
    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === 'user_1') return { _id: 'user_1', organizationId: 'org_1', role: 'owner' }
          if (id === 'approval_1')
            return {
              _id: 'approval_1',
              organizationId: 'org_1',
              executionId: 'exec_1',
              status: 'pending',
              expiresAt: now + 60_000,
              riskLevel: 'high',
            }
          return null
        },
        patch: async () => {},
        insert: async () => 'audit_1',
      },
      scheduler: {
        runAfter: async (_delay: number, _fnRef: unknown, payload: Record<string, unknown>) => {
          scheduledPayloads.push(payload)
        },
      },
    }

    const result = await (review as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      id: 'approval_1',
      decision: 'reject',
      rejectionReason: 'Not now',
    })

    assert.equal(result.status, 'rejected')
    assert.equal(scheduledPayloads.length, 1)
    assert.equal(scheduledPayloads[0].executionId, 'exec_1')
  })
})

describe('approvalQueue.listPending', () => {
  it('passes caller-provided now to the expires index filter', async () => {
    const now = Date.now()
    let gtFilterValue: number | undefined
    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === 'user_1') return { _id: 'user_1', organizationId: 'org_1', role: 'owner' }
          return null
        },
        query: () => ({
          withIndex: (_indexName: string, build: (q: any) => unknown) => {
            const chain = {
              eq: () => chain,
              gt: (_field: string, value: number) => {
                gtFilterValue = value
                return chain
              },
            }
            build(chain)
            return {
              take: async () => [{ _id: 'approval_active', expiresAt: now + 60_000 }],
            }
          },
        }),
      },
    }

    const result = await (listPending as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      now,
      limit: 10,
    })

    assert.equal(result.length, 1)
    assert.equal(result[0]._id, 'approval_active')
    assert.equal(gtFilterValue, now)
  })

  it('redacts payload fields for non-reviewers', async () => {
    const now = Date.now()
    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === 'user_1') return { _id: 'user_1', organizationId: 'org_1', role: 'member' }
          return null
        },
        query: () => ({
          withIndex: (_indexName: string, build: (q: any) => unknown) => {
            const chain = {
              eq: () => chain,
              gt: () => chain,
            }
            build(chain)
            return {
              take: async () => [
                {
                  _id: 'approval_active',
                  action: 'update_lead_status',
                  description: 'Promote lead',
                  riskLevel: 'high',
                  status: 'pending',
                  createdAt: now - 10_000,
                  expiresAt: now + 60_000,
                },
              ],
            }
          },
        }),
      },
    }

    const result = await (listPending as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      now,
      limit: 10,
    })

    assert.equal(result.length, 1)
    assert.equal(result[0].canReview, false)
    assert.equal(result[0].action, undefined)
    assert.equal(result[0].description, undefined)
  })

  it('allows server token bypass in development when auth session is unavailable', async () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalDisableAuth = process.env.DISABLE_AUTH_IN_DEV
    const originalToken = process.env.MEMORY_API_TOKEN
    process.env.NODE_ENV = 'development'
    delete process.env.DISABLE_AUTH_IN_DEV
    process.env.MEMORY_API_TOKEN = 'token_123'

    try {
      const now = Date.now()
      const ctx = {
        db: {
          get: async (id: string) => {
            if (id === 'user_1') return { _id: 'user_1', organizationId: 'org_1', role: 'owner' }
            return null
          },
          query: () => ({
            withIndex: (_indexName: string, build: (q: any) => unknown) => {
              const chain = {
                eq: () => chain,
                gt: () => chain,
              }
              build(chain)
              return {
                take: async () => [
                  {
                    _id: 'approval_active',
                    riskLevel: 'high',
                    status: 'pending',
                    createdAt: now - 10_000,
                    expiresAt: now + 60_000,
                  },
                ],
              }
            },
          }),
        },
      }

      const result = await (listPending as any)._handler(ctx, {
        userId: 'user_1',
        organizationId: 'org_1',
        authToken: 'token_123',
        now,
        limit: 10,
      })

      assert.equal(result.length, 1)
      assert.equal(result[0]._id, 'approval_active')
    } finally {
      process.env.NODE_ENV = originalNodeEnv
      process.env.DISABLE_AUTH_IN_DEV = originalDisableAuth
      process.env.MEMORY_API_TOKEN = originalToken
    }
  })

  it('does not allow token bypass in production without authenticated session', async () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalDisableAuth = process.env.DISABLE_AUTH_IN_DEV
    const originalToken = process.env.MEMORY_API_TOKEN
    process.env.NODE_ENV = 'production'
    delete process.env.DISABLE_AUTH_IN_DEV
    process.env.MEMORY_API_TOKEN = 'token_123'

    try {
      const now = Date.now()
      const ctx = {
        db: {
          get: async (id: string) => {
            if (id === 'user_1') return { _id: 'user_1', organizationId: 'org_1', role: 'owner' }
            return null
          },
          query: () => ({
            withIndex: (_indexName: string, build: (q: any) => unknown) => {
              const chain = {
                eq: () => chain,
                gt: () => chain,
              }
              build(chain)
              return {
                take: async () => [
                  {
                    _id: 'approval_active',
                    riskLevel: 'high',
                    status: 'pending',
                    createdAt: now - 10_000,
                    expiresAt: now + 60_000,
                  },
                ],
              }
            },
          }),
        },
      }

      await assert.rejects(
        () =>
          (listPending as any)._handler(ctx, {
            userId: 'user_1',
            organizationId: 'org_1',
            authToken: 'token_123',
            now,
            limit: 10,
          }),
        /Unauthenticated access to approval queue/
      )
    } finally {
      process.env.NODE_ENV = originalNodeEnv
      process.env.DISABLE_AUTH_IN_DEV = originalDisableAuth
      process.env.MEMORY_API_TOKEN = originalToken
    }
  })
})

describe('approvalQueue.expireStalePending', () => {
  it('marks stale pending items as expired and reconciles executions', async () => {
    const patched: Array<Record<string, unknown>> = []
    const auditLogs: Array<Record<string, unknown>> = []
    const scheduledPayloads: Array<Record<string, unknown>> = []
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            take: async () => [
              {
                _id: 'approval_1',
                organizationId: 'org_1',
                executionId: 'exec_1',
                riskLevel: 'high',
              },
              {
                _id: 'approval_2',
                organizationId: 'org_1',
                executionId: 'exec_1',
                riskLevel: 'critical',
              },
            ],
          }),
        }),
        patch: async (_id: string, value: Record<string, unknown>) => {
          patched.push(value)
        },
        insert: async (_table: string, value: Record<string, unknown>) => {
          auditLogs.push(value)
          return 'audit_1'
        },
      },
      scheduler: {
        runAfter: async (_delay: number, _fnRef: unknown, payload: Record<string, unknown>) => {
          scheduledPayloads.push(payload)
        },
      },
    }

    const result = await (expireStalePending as any)._handler(ctx, { limit: 5 })

    assert.equal(result.expiredCount, 2)
    assert.equal(patched.length, 2)
    assert.equal(patched[0].status, 'expired')
    assert.equal(auditLogs.length, 2)
    assert.equal(auditLogs[0].action, 'approval_review_expired')
    assert.equal(scheduledPayloads.length, 1)
    assert.equal(scheduledPayloads[0].executionId, 'exec_1')
  })
})

describe('approvalQueue.listByStatus', () => {
  it('redacts payload for non-reviewers', async () => {
    const now = Date.now()
    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === 'user_1') return { _id: 'user_1', organizationId: 'org_1', role: 'member' }
          return null
        },
        query: () => ({
          withIndex: () => ({
            order: () => ({
              take: async () => [
                {
                  _id: 'approval_1',
                  action: 'update_lead_status',
                  description: 'Promote lead',
                  riskLevel: 'high',
                  status: 'pending',
                  createdAt: now - 20_000,
                  expiresAt: now + 40_000,
                },
              ],
            }),
          }),
        }),
      },
    }

    const rows = await (listByStatus as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      status: 'pending',
      limit: 20,
    })

    assert.equal(rows.length, 1)
    assert.equal(rows[0].canReview, false)
    assert.equal(rows[0].action, undefined)
    assert.equal(rows[0].description, undefined)
  })
})

describe('approvalQueue.claimApprovedForExecution', () => {
  it('claims approved rows and blocks duplicate claims within lease window', async () => {
    const patches: Array<Record<string, unknown>> = []
    const originalNow = Date.now
    Date.now = () => 1_700_000_000_000

    try {
      let currentRow: Record<string, unknown> = {
        _id: 'approval_1',
        status: 'approved',
        executionClaimedAt: undefined,
        executionProcessedAt: undefined,
        updatedAt: 1_699_999_999_000,
      }
      const ctx = {
        db: {
          get: async () => currentRow,
          patch: async (_id: string, patch: Record<string, unknown>) => {
            patches.push(patch)
            currentRow = { ...currentRow, ...patch }
          },
        },
      }

      const first = await (claimApprovedForExecution as any)._handler(ctx, { id: 'approval_1' })
      const second = await (claimApprovedForExecution as any)._handler(ctx, { id: 'approval_1' })

      assert.equal(first.claimed, true)
      assert.equal(second.claimed, false)
      assert.equal(second.reason, 'already_claimed')
      assert.equal(patches.length, 1)
    } finally {
      Date.now = originalNow
    }
  })

  it('allows reclaiming stale claims after lease timeout', async () => {
    const patches: Array<Record<string, unknown>> = []
    const originalNow = Date.now
    Date.now = () => 1_700_000_300_000

    try {
      const ctx = {
        db: {
          get: async () => ({
            _id: 'approval_1',
            status: 'approved',
            executionClaimedAt: 1_700_000_000_000,
            executionProcessedAt: undefined,
            updatedAt: 1_700_000_000_000,
          }),
          patch: async (_id: string, patch: Record<string, unknown>) => {
            patches.push(patch)
          },
        },
      }

      const result = await (claimApprovedForExecution as any)._handler(ctx, { id: 'approval_1' })
      assert.equal(result.claimed, true)
      assert.equal(patches.length, 1)
    } finally {
      Date.now = originalNow
    }
  })
})

describe('approvalQueue.recordExecutionAttemptFailure', () => {
  it('increments retry count and schedules another retry before max attempts', async () => {
    const patches: Array<Record<string, unknown>> = []
    const originalNow = Date.now
    Date.now = () => 1_700_000_000_000

    try {
      const ctx = {
        db: {
          get: async () => ({
            _id: 'approval_1',
            status: 'approved',
            executionRetryCount: 0,
          }),
          patch: async (_id: string, patch: Record<string, unknown>) => {
            patches.push(patch)
          },
        },
      }

      const result = await (recordExecutionAttemptFailure as any)._handler(ctx, {
        id: 'approval_1',
      })
      assert.equal(result.shouldRetry, true)
      assert.equal(result.retryDelayMs, 30_000)
      assert.equal(result.retryCount, 1)
      assert.equal(patches.length, 1)
      assert.equal(patches[0].executionRetryCount, 1)
      assert.equal(patches[0].executionProcessedAt, undefined)
    } finally {
      Date.now = originalNow
    }
  })

  it('marks as processed after max retry attempts', async () => {
    const patches: Array<Record<string, unknown>> = []
    const originalNow = Date.now
    Date.now = () => 1_700_000_999_000

    try {
      const ctx = {
        db: {
          get: async () => ({
            _id: 'approval_1',
            status: 'approved',
            executionRetryCount: 2,
          }),
          patch: async (_id: string, patch: Record<string, unknown>) => {
            patches.push(patch)
          },
        },
      }

      const result = await (recordExecutionAttemptFailure as any)._handler(ctx, {
        id: 'approval_1',
      })
      assert.equal(result.shouldRetry, false)
      assert.equal(result.retryDelayMs, 0)
      assert.equal(result.retryCount, 3)
      assert.equal(patches.length, 1)
      assert.equal(patches[0].executionRetryCount, 3)
      assert.equal(patches[0].executionProcessedAt, 1_700_000_999_000)
    } finally {
      Date.now = originalNow
    }
  })
})

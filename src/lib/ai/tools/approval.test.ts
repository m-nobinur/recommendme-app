import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createApprovalTools } from './approval'

function makeMockCtx(overrides: {
  queryResult?: unknown[]
  mutationResult?: Record<string, unknown>
  shouldThrow?: boolean
}) {
  return {
    organizationId: 'org_test123',
    userId: 'user_test123',
    convexUrl: 'https://fake.convex.cloud',
    convexClient: {
      query: async () => {
        if (overrides.shouldThrow) throw new Error('Network failure')
        return overrides.queryResult ?? []
      },
      mutation: async () => {
        if (overrides.shouldThrow) throw new Error('Network failure')
        return overrides.mutationResult ?? { status: 'approved' }
      },
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper to bypass AI SDK generics
type AnyResult = any

async function execListPendingApprovals(
  tools: ReturnType<typeof createApprovalTools>,
  args: { limit?: number } = {}
): Promise<AnyResult> {
  const exec = tools.listPendingApprovals.execute
  if (!exec) throw new Error('listPendingApprovals.execute is undefined')
  return exec(args, { toolCallId: 'tc_1', messages: [], abortSignal: undefined as never })
}

async function execApproveAction(
  tools: ReturnType<typeof createApprovalTools>,
  args: { approvalId: string }
): Promise<AnyResult> {
  const exec = tools.approveAction.execute
  if (!exec) throw new Error('approveAction.execute is undefined')
  return exec(args, { toolCallId: 'tc_1', messages: [], abortSignal: undefined as never })
}

async function execRejectAction(
  tools: ReturnType<typeof createApprovalTools>,
  args: { approvalId: string; reason?: string }
): Promise<AnyResult> {
  const exec = tools.rejectAction.execute
  if (!exec) throw new Error('rejectAction.execute is undefined')
  return exec(args, { toolCallId: 'tc_1', messages: [], abortSignal: undefined as never })
}

describe('createApprovalTools', () => {
  it('returns approval tools', () => {
    const tools = createApprovalTools(makeMockCtx({}) as never)
    assert.ok(tools.listPendingApprovals)
    assert.ok(tools.approveAction)
    assert.ok(tools.rejectAction)
  })
})

describe('listPendingApprovals execute', () => {
  it('returns formatted approvals', async () => {
    const tools = createApprovalTools(
      makeMockCtx({
        queryResult: [
          {
            _id: 'approval_1',
            agentType: 'sales',
            action: 'update_lead_status',
            target: 'lead_1',
            riskLevel: 'high',
            description: 'Move lead to qualified',
            expiresAt: 1_700_000_000_000,
            createdAt: 1_699_000_000_000,
          },
        ],
      }) as never
    )

    const result = await execListPendingApprovals(tools, { limit: 5 })
    assert.equal(result.success, true)
    assert.equal(result.data.count, 1)
    assert.equal(result.data.approvals[0].id, 'approval_1')
    assert.equal(result.data.approvals[0].riskLevel, 'high')
  })

  it('handles query failures gracefully', async () => {
    const tools = createApprovalTools(makeMockCtx({ shouldThrow: true }) as never)
    const result = await execListPendingApprovals(tools)
    assert.equal(result.success, false)
    assert.ok(result.error.includes('Network failure'))
  })

  it('falls back to redacted metadata when reviewer details are hidden', async () => {
    const tools = createApprovalTools(
      makeMockCtx({
        queryResult: [
          {
            _id: 'approval_2',
            riskLevel: 'critical',
            expiresAt: 1_700_000_000_000,
            createdAt: 1_699_000_000_000,
          },
        ],
      }) as never
    )

    const result = await execListPendingApprovals(tools, { limit: 5 })
    assert.equal(result.success, true)
    assert.equal(result.data.count, 1)
    assert.equal(result.data.approvals[0].action, 'redacted')
    assert.ok(result.data.approvals[0].description.includes('owner/admin'))
  })
})

describe('approveAction/rejectAction execute', () => {
  it('approves an action and returns status with execution note', async () => {
    const tools = createApprovalTools(
      makeMockCtx({ mutationResult: { status: 'approved' } }) as never
    )
    const result = await execApproveAction(tools, { approvalId: 'approval_1' })
    assert.equal(result.success, true)
    assert.equal(result.data.status, 'approved')
    assert.ok(result.message.includes('immediate execution'))
  })

  it('rejects an action and returns status', async () => {
    const tools = createApprovalTools(
      makeMockCtx({ mutationResult: { status: 'rejected' } }) as never
    )
    const result = await execRejectAction(tools, {
      approvalId: 'approval_2',
      reason: 'Too risky',
    })
    assert.equal(result.success, true)
    assert.equal(result.data.status, 'rejected')
  })
})

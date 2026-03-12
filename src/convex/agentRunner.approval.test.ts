import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { executeApprovedQueueItem, reconcileExecutionAfterApprovalDecision } from './agentRunner'

describe('executeApprovedQueueItem', () => {
  it('executes approved actions with original params', async () => {
    const runMutationCalls: Array<Record<string, unknown>> = []
    let queryCount = 0
    let idMutationCount = 0
    const ctx = {
      runQuery: async () => {
        queryCount++
        if (queryCount === 1) {
          return {
            _id: 'approval_1',
            organizationId: 'org_1',
            executionId: 'exec_1',
            agentType: 'followup',
            action: 'update_lead_status',
            target: 'lead_1',
            actionParams: { status: 'Qualified' },
            riskLevel: 'high',
            status: 'approved',
            reviewedAt: 10,
            updatedAt: 10,
          }
        }
        if (queryCount === 2) {
          return {
            _id: 'exec_1',
            status: 'awaiting_approval',
            actionsPlanned: 1,
            actionsExecuted: 0,
            actionsSkipped: 0,
            results: {},
          }
        }
        if (queryCount === 3) {
          return {
            _id: 'exec_1',
            status: 'awaiting_approval',
            actionsPlanned: 1,
            actionsExecuted: 0,
            actionsSkipped: 0,
            results: {},
          }
        }
        if (queryCount === 4) {
          return [
            {
              _id: 'approval_1',
              status: 'approved',
              executionProcessedAt: 11,
            },
          ]
        }
        return null
      },
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        runMutationCalls.push(args)
        if (Object.keys(args).length === 1 && args.id) {
          idMutationCount++
          return idMutationCount === 1 ? { claimed: true } : { updated: true }
        }
        return null
      },
      runAction: async (_fn: unknown, args: Record<string, unknown>) => {
        await (reconcileExecutionAfterApprovalDecision as any)._handler(ctx, args)
        return null
      },
    }

    const result = await (executeApprovedQueueItem as any)._handler(ctx, {
      approvalId: 'approval_1',
    })

    assert.equal(result.status, 'executed')
    const sideEffectCall = runMutationCalls.find(
      (call) =>
        call.organizationId === 'org_1' && call.leadId === 'lead_1' && call.status === 'Qualified'
    )
    assert.ok(sideEffectCall)
  })

  it('records approval execution result for approved queue items', async () => {
    const runMutationCalls: Array<Record<string, unknown>> = []
    let queryCount = 0
    let idMutationCount = 0
    const ctx = {
      runQuery: async () => {
        queryCount++
        if (queryCount === 1) {
          return {
            _id: 'approval_1',
            organizationId: 'org_1',
            executionId: 'exec_1',
            agentType: 'followup',
            action: 'log_recommendation',
            target: 'lead_1',
            actionParams: { recommendation: 'Reach out tomorrow' },
            riskLevel: 'high',
            status: 'approved',
            reviewedAt: 10,
            updatedAt: 10,
          }
        }
        if (queryCount === 2) {
          return {
            _id: 'exec_1',
            status: 'awaiting_approval',
            results: {},
          }
        }
        if (queryCount === 3) {
          return {
            _id: 'exec_1',
            status: 'awaiting_approval',
            results: {},
          }
        }
        if (queryCount === 4) {
          return [
            {
              _id: 'approval_1',
              status: 'approved',
              executionProcessedAt: 11,
            },
          ]
        }
        return null
      },
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        runMutationCalls.push(args)
        if (Object.keys(args).length === 1 && args.id) {
          idMutationCount++
          return idMutationCount === 1 ? { claimed: true } : { updated: true }
        }
        return null
      },
      runAction: async (_fn: unknown, args: Record<string, unknown>) => {
        await (reconcileExecutionAfterApprovalDecision as any)._handler(ctx, args)
        return null
      },
    }

    await (executeApprovedQueueItem as any)._handler(ctx, {
      approvalId: 'approval_1',
    })

    const recorded = runMutationCalls.find((call) => call.approvalId === 'approval_1')
    assert.ok(recorded)
    assert.equal(recorded?.executionId, 'exec_1')
    assert.equal(recorded?.approvalId, 'approval_1')
  })

  it('skips re-execution when approval result is already recorded', async () => {
    const runMutationCalls: Array<Record<string, unknown>> = []
    let queryCount = 0
    const ctx = {
      runQuery: async () => {
        queryCount++
        if (queryCount === 1) {
          return {
            _id: 'approval_1',
            organizationId: 'org_1',
            executionId: 'exec_1',
            agentType: 'followup',
            action: 'update_lead_status',
            target: 'lead_1',
            actionParams: { status: 'Qualified' },
            riskLevel: 'high',
            status: 'approved',
            reviewedAt: 10,
            updatedAt: 10,
          }
        }
        if (queryCount === 2) {
          return {
            _id: 'exec_1',
            status: 'awaiting_approval',
            results: {
              approvalExecutionResults: [{ approvalId: 'approval_1', success: true }],
            },
          }
        }
        if (queryCount === 3) {
          return {
            _id: 'exec_1',
            status: 'awaiting_approval',
            actionsPlanned: 1,
            actionsExecuted: 1,
            actionsSkipped: 0,
            results: {
              approvalExecutionResults: [{ approvalId: 'approval_1', success: true }],
            },
          }
        }
        if (queryCount === 4) {
          return [
            {
              _id: 'approval_1',
              status: 'approved',
              reviewedAt: 10,
              updatedAt: 11,
            },
          ]
        }
        return null
      },
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        runMutationCalls.push(args)
        return null
      },
      runAction: async (_fn: unknown, args: Record<string, unknown>) => {
        await (reconcileExecutionAfterApprovalDecision as any)._handler(ctx, args)
        return null
      },
    }

    const result = await (executeApprovedQueueItem as any)._handler(ctx, {
      approvalId: 'approval_1',
    })

    assert.equal(result.status, 'skipped')
    const recorded = runMutationCalls.find((call) => call.approvalId === 'approval_1')
    assert.equal(recorded, undefined)
  })

  it('schedules retry for retryable approved action failures', async () => {
    const runMutationCalls: Array<Record<string, unknown>> = []
    const scheduled: Array<Record<string, unknown>> = []
    let queryCount = 0
    let idMutationCount = 0
    const ctx = {
      runQuery: async () => {
        queryCount++
        if (queryCount === 1) {
          return {
            _id: 'approval_1',
            organizationId: 'org_1',
            executionId: 'exec_1',
            agentType: 'followup',
            action: 'update_lead_status',
            target: 'lead_1',
            actionParams: { status: 'Qualified' },
            riskLevel: 'high',
            status: 'approved',
            reviewedAt: 10,
            updatedAt: 10,
          }
        }
        if (queryCount === 2) {
          return {
            _id: 'exec_1',
            status: 'awaiting_approval',
            results: {},
          }
        }
        return null
      },
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        runMutationCalls.push(args)
        if (Object.keys(args).length === 1 && args.id) {
          idMutationCount++
          if (idMutationCount === 1) {
            return { claimed: true }
          }
          return { shouldRetry: true, retryDelayMs: 30_000, retryCount: 1 }
        }
        if (args.leadId === 'lead_1') {
          throw new Error('transient backend failure')
        }
        return null
      },
      scheduler: {
        runAfter: async (_delay: number, _fnRef: unknown, payload: Record<string, unknown>) => {
          scheduled.push(payload)
        },
      },
      runAction: async () => null,
    }

    const result = await (executeApprovedQueueItem as any)._handler(ctx, {
      approvalId: 'approval_1',
    })

    assert.equal(result.status, 'skipped')
    assert.equal(result.reason, 'execution_retry_scheduled')
    assert.equal(scheduled.length, 1)
    assert.equal(scheduled[0].approvalId, 'approval_1')
    const recorded = runMutationCalls.find((call) => call.approvalId === 'approval_1')
    assert.equal(recorded, undefined)
  })

  it('does not retry side effects after success when finalize bookkeeping fails', async () => {
    const runMutationCalls: Array<Record<string, unknown>> = []
    const scheduled: Array<Record<string, unknown>> = []
    let queryCount = 0
    let idMutationCount = 0
    const ctx = {
      runQuery: async () => {
        queryCount++
        if (queryCount === 1) {
          return {
            _id: 'approval_1',
            organizationId: 'org_1',
            executionId: 'exec_1',
            agentType: 'followup',
            action: 'update_lead_status',
            target: 'lead_1',
            actionParams: { status: 'Qualified' },
            riskLevel: 'high',
            status: 'approved',
            reviewedAt: 10,
            updatedAt: 10,
          }
        }
        if (queryCount === 2) {
          return {
            _id: 'exec_1',
            status: 'awaiting_approval',
            results: {},
          }
        }
        return null
      },
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        runMutationCalls.push(args)
        if (Object.keys(args).length === 1 && args.id) {
          idMutationCount++
          if (idMutationCount === 1) {
            return { claimed: true }
          }
          throw new Error('failed to mark approval as processed')
        }
        return null
      },
      scheduler: {
        runAfter: async (_delay: number, _fnRef: unknown, payload: Record<string, unknown>) => {
          scheduled.push(payload)
        },
      },
      runAction: async () => null,
    }

    const result = await (executeApprovedQueueItem as any)._handler(ctx, {
      approvalId: 'approval_1',
    })

    assert.equal(result.status, 'skipped')
    assert.equal(result.reason, 'post_execution_finalize_failed')
    assert.equal(scheduled.length, 0)
    const sideEffectCalls = runMutationCalls.filter(
      (call) =>
        call.organizationId === 'org_1' && call.leadId === 'lead_1' && call.status === 'Qualified'
    )
    assert.equal(sideEffectCalls.length, 1)
  })
})

describe('reconcileExecutionAfterApprovalDecision', () => {
  it('completes execution when all approvals are resolved', async () => {
    const runMutationCalls: Array<Record<string, unknown>> = []
    let queryCount = 0
    const ctx = {
      runQuery: async () => {
        queryCount++
        if (queryCount === 1) {
          return {
            _id: 'exec_1',
            status: 'awaiting_approval',
            actionsPlanned: 2,
            actionsExecuted: 2,
            actionsSkipped: 0,
            results: {
              approvalExecutionResults: [{ approvalId: 'approval_2', success: true }],
            },
          }
        }
        if (queryCount === 2) {
          return [
            {
              _id: 'approval_1',
              status: 'rejected',
              reviewedAt: 10,
              updatedAt: 10,
            },
            {
              _id: 'approval_2',
              status: 'approved',
              executionProcessedAt: 11,
            },
          ]
        }
        return null
      },
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        runMutationCalls.push(args)
        return null
      },
    }

    await (reconcileExecutionAfterApprovalDecision as any)._handler(ctx, {
      executionId: 'exec_1',
    })

    const completed = runMutationCalls.find((call) => call.status === 'completed')
    assert.ok(completed)
    assert.equal(completed?.id, 'exec_1')
    assert.equal(completed?.status, 'completed')
  })

  it('fails execution when approved action execution results include failures', async () => {
    const runMutationCalls: Array<Record<string, unknown>> = []
    let queryCount = 0
    const ctx = {
      runQuery: async () => {
        queryCount++
        if (queryCount === 1) {
          return {
            _id: 'exec_1',
            status: 'awaiting_approval',
            actionsPlanned: 2,
            actionsExecuted: 1,
            actionsSkipped: 1,
            results: {
              approvalExecutionResults: [
                { approvalId: 'approval_1', success: false, message: 'Execution error: timeout' },
              ],
            },
          }
        }
        if (queryCount === 2) {
          return [
            {
              _id: 'approval_1',
              status: 'approved',
              executionProcessedAt: 11,
            },
          ]
        }
        return null
      },
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        runMutationCalls.push(args)
        return null
      },
    }

    await (reconcileExecutionAfterApprovalDecision as any)._handler(ctx, {
      executionId: 'exec_1',
    })

    const failed = runMutationCalls.find((call) => call.status === 'failed')
    assert.ok(failed)
    assert.equal(failed?.id, 'exec_1')
    assert.match(String(failed?.error), /approval execution issue/)
  })
})

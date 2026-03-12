import type { Id } from '@convex/_generated/dataModel'
import { tool } from 'ai'
import { ConvexHttpClient } from 'convex/browser'
import { z } from 'zod'
import { asAppUserId, asOrganizationId, getApi } from '../shared/convex'
import type { ToolContext, ToolResult } from './index'

interface PendingApprovalItem {
  id: string
  agentType: string
  action: string
  target?: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  description: string
  expiresAt: number
  createdAt: number
}

export function createApprovalTools(ctx: ToolContext) {
  const convex = ctx.convexClient ?? new ConvexHttpClient(ctx.convexUrl)
  const organizationId = asOrganizationId(ctx.organizationId)
  const userId = asAppUserId(ctx.userId)
  const devBypassAuthToken = ctx.memoryAuthToken ?? process.env.MEMORY_API_TOKEN
  const isAuthBypassMode =
    process.env.DISABLE_AUTH_IN_DEV === 'true' || process.env.NODE_ENV === 'test'

  const fetchWithAuthQuery = async <T>(
    queryRef: unknown,
    args: Record<string, unknown>
  ): Promise<T> => {
    const auth = await import('@/lib/auth')
    return (await auth.fetchAuthQuery(queryRef as never, args as never)) as T
  }

  const fetchWithAuthMutation = async <T>(
    mutationRef: unknown,
    args: Record<string, unknown>
  ): Promise<T> => {
    const auth = await import('@/lib/auth')
    return (await auth.fetchAuthMutation(mutationRef as never, args as never)) as T
  }

  return {
    listPendingApprovals: tool({
      description:
        'List pending high-risk agent actions that require manual approval before execution.',
      inputSchema: z.object({
        limit: z
          .number()
          .min(1)
          .max(200)
          .optional()
          .describe('Maximum number of approvals to return'),
      }),
      execute: async (
        args
      ): Promise<ToolResult<{ approvals: PendingApprovalItem[]; count: number }>> => {
        try {
          const { api } = await getApi()
          const rows = isAuthBypassMode
            ? await convex.query(api.approvalQueue.listPending, {
                userId,
                organizationId,
                authToken: devBypassAuthToken,
                now: Date.now(),
                limit: args.limit,
              })
            : await fetchWithAuthQuery(api.approvalQueue.listPending, {
                userId,
                organizationId,
                authToken: devBypassAuthToken,
                now: Date.now(),
                limit: args.limit,
              })

          const approvals = (
            rows as Array<{
              _id: string
              agentType?: string
              action?: string
              target?: string
              riskLevel: 'low' | 'medium' | 'high' | 'critical'
              description?: string
              expiresAt: number
              createdAt: number
            }>
          ).map((row) => ({
            id: row._id,
            agentType: row.agentType ?? 'approval',
            action: row.action ?? 'redacted',
            target: row.target,
            riskLevel: row.riskLevel,
            description:
              row.description ?? 'Requires owner/admin review to view full approval details.',
            expiresAt: row.expiresAt,
            createdAt: row.createdAt,
          }))

          return {
            success: true,
            data: {
              approvals,
              count: approvals.length,
            },
            message:
              approvals.length > 0
                ? `Found ${approvals.length} pending approval item(s).`
                : 'No pending approvals right now.',
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to list pending approvals: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    approveAction: tool({
      description:
        'Approve a pending queue item. The approved action is executed asynchronously right after approval.',
      inputSchema: z.object({
        approvalId: z.string().describe('Approval queue item ID'),
      }),
      execute: async (args): Promise<ToolResult<{ status: string }>> => {
        try {
          const { api } = await getApi()
          const result = (
            isAuthBypassMode
              ? await convex.mutation(api.approvalQueue.review, {
                  userId,
                  organizationId,
                  authToken: devBypassAuthToken,
                  id: args.approvalId as Id<'approvalQueue'>,
                  decision: 'approve',
                })
              : await fetchWithAuthMutation(api.approvalQueue.review, {
                  userId,
                  organizationId,
                  authToken: devBypassAuthToken,
                  id: args.approvalId as Id<'approvalQueue'>,
                  decision: 'approve',
                })
          ) as { status: 'approved' | 'rejected' | 'expired' }

          const statusMsg =
            result.status === 'expired'
              ? `Approval ${args.approvalId} has expired and can no longer be approved.`
              : `Approval ${args.approvalId} marked as ${result.status}. The approved action has been queued for immediate execution.`

          return {
            success: true,
            data: { status: result.status as string },
            message: statusMsg,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to approve action: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    rejectAction: tool({
      description: 'Reject a pending approval queue item.',
      inputSchema: z.object({
        approvalId: z.string().describe('Approval queue item ID'),
        reason: z.string().optional().describe('Optional rejection reason to store'),
      }),
      execute: async (args): Promise<ToolResult<{ status: string }>> => {
        try {
          const { api } = await getApi()
          const result = (
            isAuthBypassMode
              ? await convex.mutation(api.approvalQueue.review, {
                  userId,
                  organizationId,
                  authToken: devBypassAuthToken,
                  id: args.approvalId as Id<'approvalQueue'>,
                  decision: 'reject',
                  rejectionReason: args.reason,
                })
              : await fetchWithAuthMutation(api.approvalQueue.review, {
                  userId,
                  organizationId,
                  authToken: devBypassAuthToken,
                  id: args.approvalId as Id<'approvalQueue'>,
                  decision: 'reject',
                  rejectionReason: args.reason,
                })
          ) as { status: 'approved' | 'rejected' | 'expired' }

          return {
            success: true,
            data: { status: result.status as string },
            message: `Approval ${args.approvalId} marked as ${result.status}.`,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to reject action: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),
  }
}

export type ApprovalTools = ReturnType<typeof createApprovalTools>

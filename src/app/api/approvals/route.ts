import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { ConvexHttpClient } from 'convex/browser'
import { fetchAuthMutation, fetchAuthQuery } from '@/lib/auth'
import { getServerSession } from '@/lib/auth/server'
import { HTTP_STATUS } from '@/lib/constants'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50
const DEV_BYPASS_AUTH_TOKEN = process.env.MEMORY_API_TOKEN

interface ApprovalQueueRow {
  _id: string
  action?: string
  target?: string
  description?: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  createdAt: number
  expiresAt: number
  canReview?: boolean
}

interface ApprovalNotificationItem {
  _id: string
  action?: string
  target?: string
  description?: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  createdAt: number
  expiresAt: number
  canReview: boolean
}

interface ApprovalReviewRequest {
  approvalId?: string
  decision?: 'approve' | 'reject'
  rejectionReason?: string
}

function isClientValidationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return (
    message.includes('ArgumentValidationError') ||
    message.includes('Invalid argument') ||
    message.includes('Expected') ||
    message.includes('Invalid value')
  )
}

export const runtime = 'nodejs'

let convexClient: ConvexHttpClient | null = null
function getConvexClient(): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) return null
  if (!convexClient) {
    convexClient = new ConvexHttpClient(url)
  }
  return convexClient
}

async function resolveAppUser() {
  const isDevMode =
    process.env.DISABLE_AUTH_IN_DEV === 'true' && process.env.NODE_ENV !== 'production'
  if (isDevMode) {
    const devUserId = process.env.DEV_USER_ID
    const convex = getConvexClient()
    if (!devUserId || !convex) return null
    return await convex.query(api.appUsers.getAppUser, {
      id: devUserId as Id<'appUsers'>,
    })
  }

  const session = await getServerSession()
  if (!session?.user?.id) {
    return null
  }

  return await fetchAuthQuery(api.appUsers.getAppUserByAuthId, {
    authUserId: session.user.id,
  })
}

export async function GET(req: Request) {
  try {
    const appUser = await resolveAppUser()
    if (!appUser) {
      return Response.json({ error: 'Unauthorized' }, { status: HTTP_STATUS.UNAUTHORIZED })
    }
    const isAuthBypassMode =
      process.env.DISABLE_AUTH_IN_DEV === 'true' && process.env.NODE_ENV !== 'production'
    const convex = isAuthBypassMode ? getConvexClient() : null
    if (isAuthBypassMode && !convex) {
      return Response.json(
        { error: 'Server configuration error' },
        { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
      )
    }

    const { searchParams } = new URL(req.url)
    const requestedLimit = Number(searchParams.get('limit') ?? DEFAULT_LIMIT)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_LIMIT)
      : DEFAULT_LIMIT

    let rows: ApprovalQueueRow[]
    if (isAuthBypassMode) {
      const convexClient = convex
      if (!convexClient) {
        return Response.json(
          { error: 'Server configuration error' },
          { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
        )
      }
      rows = (await convexClient.query(api.approvalQueue.listPending, {
        userId: appUser._id,
        organizationId: appUser.organizationId,
        authToken: DEV_BYPASS_AUTH_TOKEN,
        now: Date.now(),
        limit,
      })) as ApprovalQueueRow[]
    } else {
      rows = (await fetchAuthQuery(api.approvalQueue.listPending, {
        userId: appUser._id,
        organizationId: appUser.organizationId,
        authToken: DEV_BYPASS_AUTH_TOKEN,
        now: Date.now(),
        limit,
      })) as ApprovalQueueRow[]
    }

    const canReview = appUser.role === 'owner' || appUser.role === 'admin'
    const notifications: ApprovalNotificationItem[] = rows.map((row) =>
      canReview
        ? {
            _id: row._id,
            action: row.action,
            target: row.target,
            description: row.description,
            riskLevel: row.riskLevel,
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
            canReview: true,
          }
        : {
            _id: row._id,
            riskLevel: row.riskLevel,
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
            canReview: false,
          }
    )

    return Response.json({ notifications })
  } catch (error) {
    console.error('[ApprovalsAPI] Failed to list pending approvals:', error)
    return Response.json(
      { error: 'Failed to fetch approval notifications' },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    )
  }
}

export async function POST(req: Request) {
  try {
    const appUser = await resolveAppUser()
    if (!appUser) {
      return Response.json({ error: 'Unauthorized' }, { status: HTTP_STATUS.UNAUTHORIZED })
    }
    const isAuthBypassMode =
      process.env.DISABLE_AUTH_IN_DEV === 'true' && process.env.NODE_ENV !== 'production'
    const convex = isAuthBypassMode ? getConvexClient() : null
    if (isAuthBypassMode && !convex) {
      return Response.json(
        { error: 'Server configuration error' },
        { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
      )
    }

    const canReview = appUser.role === 'owner' || appUser.role === 'admin'
    if (!canReview) {
      return Response.json(
        { error: 'Only owners/admins can review approval items' },
        { status: HTTP_STATUS.FORBIDDEN }
      )
    }

    let body: ApprovalReviewRequest
    try {
      body = (await req.json()) as ApprovalReviewRequest
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: HTTP_STATUS.BAD_REQUEST })
    }
    const approvalId = body.approvalId?.trim()
    const decision = body.decision
    if (!approvalId || (decision !== 'approve' && decision !== 'reject')) {
      return Response.json(
        { error: 'approvalId and decision are required' },
        { status: HTTP_STATUS.BAD_REQUEST }
      )
    }

    let result: { status: string }
    if (isAuthBypassMode) {
      const convexClient = convex
      if (!convexClient) {
        return Response.json(
          { error: 'Server configuration error' },
          { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
        )
      }
      result = await convexClient.mutation(api.approvalQueue.review, {
        userId: appUser._id,
        organizationId: appUser.organizationId,
        authToken: DEV_BYPASS_AUTH_TOKEN,
        id: approvalId as Id<'approvalQueue'>,
        decision,
        rejectionReason: body.rejectionReason?.trim(),
      })
    } else {
      result = await fetchAuthMutation(api.approvalQueue.review, {
        userId: appUser._id,
        organizationId: appUser.organizationId,
        authToken: DEV_BYPASS_AUTH_TOKEN,
        id: approvalId as Id<'approvalQueue'>,
        decision,
        rejectionReason: body.rejectionReason?.trim(),
      })
    }

    return Response.json(result)
  } catch (error) {
    console.error('[ApprovalsAPI] Failed to review approval item:', error)
    if (isClientValidationError(error)) {
      return Response.json(
        { error: 'Invalid approval review payload' },
        { status: HTTP_STATUS.BAD_REQUEST }
      )
    }
    return Response.json(
      { error: 'Failed to review approval item' },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    )
  }
}

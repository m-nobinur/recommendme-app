import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { ConvexHttpClient } from 'convex/browser'
import { fetchAuthMutation, fetchAuthQuery } from '@/lib/auth'
import { getServerSession } from '@/lib/auth/server'
import { HTTP_STATUS } from '@/lib/constants'

export const runtime = 'nodejs'

interface PushSubscriptionPayload {
  endpoint?: unknown
  keys?: {
    p256dh?: unknown
    auth?: unknown
  }
}

interface ResubscribeRequestBody {
  oldEndpoint?: unknown
  newSubscription?: PushSubscriptionPayload
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

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
  if (!session?.user?.id) return null

  return await fetchAuthQuery(api.appUsers.getAppUserByAuthId, {
    authUserId: session.user.id,
  })
}

function isValidSubscription(subscription: PushSubscriptionPayload | undefined): subscription is {
  endpoint: string
  keys: { p256dh: string; auth: string }
} {
  return (
    !!subscription &&
    typeof subscription.endpoint === 'string' &&
    typeof subscription.keys?.p256dh === 'string' &&
    typeof subscription.keys?.auth === 'string'
  )
}

export async function POST(req: Request) {
  try {
    let body: ResubscribeRequestBody
    try {
      body = (await req.json()) as ResubscribeRequestBody
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: HTTP_STATUS.BAD_REQUEST,
        headers: JSON_HEADERS,
      })
    }

    if (!isValidSubscription(body.newSubscription)) {
      return new Response(JSON.stringify({ error: 'Invalid push subscription payload' }), {
        status: HTTP_STATUS.BAD_REQUEST,
        headers: JSON_HEADERS,
      })
    }

    const appUser = await resolveAppUser()
    if (!appUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: HTTP_STATUS.UNAUTHORIZED,
        headers: JSON_HEADERS,
      })
    }

    if (typeof body.oldEndpoint === 'string' && body.oldEndpoint.length > 0) {
      await fetchAuthMutation(api.pushSubscriptions.unsubscribe, {
        organizationId: appUser.organizationId,
        endpoint: body.oldEndpoint,
      })
    }

    await fetchAuthMutation(api.pushSubscriptions.subscribe, {
      organizationId: appUser.organizationId,
      endpoint: body.newSubscription.endpoint,
      p256dh: body.newSubscription.keys.p256dh,
      auth: body.newSubscription.keys.auth,
    })

    return new Response(JSON.stringify({ success: true }), {
      status: HTTP_STATUS.OK,
      headers: JSON_HEADERS,
    })
  } catch (error) {
    console.error('[PushResubscribeAPI] Failed to rotate push subscription:', error)
    return new Response(JSON.stringify({ error: 'Failed to resubscribe push notifications' }), {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      headers: JSON_HEADERS,
    })
  }
}

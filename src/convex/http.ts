import { httpRouter } from 'convex/server'
import { internal } from './_generated/api'
import { httpAction } from './_generated/server'
import { authComponent, createAuth } from './auth'

const http = httpRouter()

/**
 * Register Better Auth routes
 * This enables authentication endpoints on the Convex backend
 */
authComponent.registerRoutes(http, createAuth)

/**
 * Resend webhook handler for email delivery tracking.
 * Configure in Resend dashboard → Webhooks → https://YOUR_CONVEX_URL/webhooks/resend
 *
 * Events tracked: email.sent, email.delivered, email.delivery_delayed,
 *                 email.bounced, email.complained
 */
const resendWebhook = httpAction(async (ctx, request) => {
  const signingSecret = process.env.RESEND_WEBHOOK_SECRET
  if (!signingSecret) {
    return new Response('Webhook secret not configured', { status: 500 })
  }

  const svixId = request.headers.get('svix-id')
  const svixTimestamp = request.headers.get('svix-timestamp')
  const svixSignature = request.headers.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response('Missing webhook signature headers', { status: 400 })
  }

  let payload: {
    type: string
    data: { email_id?: string }
  }

  try {
    payload = await request.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const eventType = payload.type
  const emailId = payload.data?.email_id

  if (!emailId) {
    return new Response('OK', { status: 200 })
  }

  const EVENT_MAP: Record<string, string> = {
    'email.sent': 'sent',
    'email.delivered': 'delivered',
    'email.delivery_delayed': 'delivery_delayed',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
  }

  const deliveryStatus = EVENT_MAP[eventType]
  if (!deliveryStatus) {
    return new Response('OK', { status: 200 })
  }

  await ctx.runMutation(internal.communicationQueue.updateDeliveryStatus, {
    externalMessageId: emailId,
    deliveryStatus: deliveryStatus as
      | 'sent'
      | 'delivered'
      | 'delivery_delayed'
      | 'bounced'
      | 'complained',
  })

  return new Response('OK', { status: 200 })
})

http.route({
  path: '/webhooks/resend',
  method: 'POST',
  handler: resendWebhook,
})

export default http

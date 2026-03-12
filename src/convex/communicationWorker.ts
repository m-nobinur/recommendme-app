'use node'

import { Resend } from 'resend'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction } from './_generated/server'
import { isCronDisabled } from './lib/cronGuard'

/**
 * Communication Worker — Node.js action for email/SMS delivery.
 *
 * Mutations and queries live in communicationQueue.ts (no 'use node')
 * because Convex requires 'use node' files only export actions.
 */

const MAX_BATCH_SIZE = 20
const DEFAULT_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'notifications@recommendme.app'

type Channel = 'email' | 'sms' | 'in_app'

function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

function isSmsConfigured(): boolean {
  return !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN
}

async function renderTemplate(
  templateName: string | undefined,
  templateProps: Record<string, string | undefined> | undefined,
  fallbackBody: string
): Promise<string> {
  if (!templateName || !templateProps) return fallbackBody

  try {
    const { renderEmailHtml } = await import('../lib/email/templates')
    return await renderEmailHtml({
      template: templateName as 'followup' | 'reminder' | 'invoice' | 'generic',
      props: templateProps,
    })
  } catch {
    return fallbackBody
  }
}

async function deliverEmail(
  to: string,
  subject: string,
  body: string,
  templateName?: string,
  templateProps?: Record<string, string | undefined>
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  if (!isEmailConfigured()) {
    return { success: false, error: 'RESEND_API_KEY not configured' }
  }

  const html = await renderTemplate(templateName, templateProps, body)
  const resend = new Resend(process.env.RESEND_API_KEY)

  const { data, error } = await resend.emails.send({
    from: DEFAULT_FROM_EMAIL,
    to,
    subject,
    html,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, messageId: data?.id }
}

async function deliverSms(
  _to: string,
  _body: string
): Promise<{ success: boolean; error?: string }> {
  if (!isSmsConfigured()) {
    return { success: false, error: 'Twilio credentials not configured' }
  }

  return { success: false, error: 'SMS delivery not yet implemented — awaiting Twilio setup' }
}

export const processQueue = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{ processed: number; sent: number; failed: number; skipped: number }> => {
    if (isCronDisabled()) return { processed: 0, sent: 0, failed: 0, skipped: 0 }

    const now = Date.now()
    const batch = (await ctx.runQuery(internal.communicationQueue.getPendingBatch, {
      limit: MAX_BATCH_SIZE,
      now,
    })) as Array<{
      _id: Id<'communicationQueue'>
      organizationId: Id<'organizations'>
      channel: Channel
      recipientAddress?: string
      recipientId: string
      subject?: string
      body: string
      templateName?: string
      templateProps?: Record<string, string | undefined>
    }>

    if (batch.length === 0) return { processed: 0, sent: 0, failed: 0, skipped: 0 }

    let sent = 0
    let failed = 0
    let skipped = 0

    for (const msg of batch) {
      const claimed = await ctx.runMutation(internal.communicationQueue.claimMessage, {
        id: msg._id,
      })
      if (!claimed) continue

      try {
        let result: { success: boolean; error?: string; messageId?: string }

        switch (msg.channel) {
          case 'email': {
            if (!msg.recipientAddress) {
              result = { success: false, error: 'No recipient email address' }
            } else {
              result = await deliverEmail(
                msg.recipientAddress,
                msg.subject ?? '',
                msg.body,
                msg.templateName,
                msg.templateProps
              )
            }
            break
          }
          case 'sms': {
            if (!msg.recipientAddress) {
              result = { success: false, error: 'No recipient phone number' }
            } else {
              result = await deliverSms(msg.recipientAddress, msg.body)
            }
            break
          }
          case 'in_app': {
            result = { success: true }
            break
          }
        }

        if (result.success) {
          await ctx.runMutation(internal.communicationQueue.markSent, {
            id: msg._id,
            externalMessageId: result.messageId,
          })
          sent++
        } else if (result.error?.includes('not configured')) {
          await ctx.runMutation(internal.communicationQueue.markSkipped, {
            id: msg._id,
            reason: result.error,
          })
          skipped++
        } else {
          await ctx.runMutation(internal.communicationQueue.markFailed, {
            id: msg._id,
            error: result.error ?? 'Unknown delivery error',
          })
          failed++
        }
      } catch (error) {
        await ctx.runMutation(internal.communicationQueue.markFailed, {
          id: msg._id,
          error: error instanceof Error ? error.message : 'Unexpected delivery error',
        })
        failed++
      }
    }

    if (sent + failed + skipped > 0) {
      console.log(
        `[Communication] Processed ${batch.length}: ${sent} sent, ${failed} failed, ${skipped} skipped`
      )
    }

    return { processed: batch.length, sent, failed, skipped }
  },
})

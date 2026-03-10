import type { ConvexHttpClient } from 'convex/browser'
import { asAppUserId, asInvoiceId, asOrganizationId, getApi } from '../../shared/convex'
import type { ActionResult, AgentAction, AgentContext } from '../core/types'

export const INVOICE_ACTIONS = [
  'create_invoice',
  'update_invoice_status',
  'flag_overdue_invoice',
  'log_invoice_recommendation',
]

async function executeCreateInvoice(
  action: AgentAction,
  context: AgentContext,
  convex: ConvexHttpClient
): Promise<ActionResult> {
  const start = Date.now()
  try {
    const leadName = String(action.params.leadName ?? '').trim()
    const amount = Number(action.params.amount ?? 0)
    const description = String(action.params.description ?? 'Service').trim()
    const dueDate = action.params.dueDate ? String(action.params.dueDate) : undefined

    if (!leadName || amount <= 0) {
      return {
        action,
        success: false,
        message: `Invalid invoice params: leadName="${leadName}", amount=${amount}`,
        error: 'Missing lead name or invalid amount',
        durationMs: Date.now() - start,
      }
    }

    const { api } = await getApi()
    const result = await convex.mutation(api.invoices.createByLeadName, {
      organizationId: asOrganizationId(context.organizationId),
      userId: asAppUserId(context.userId),
      leadName,
      amount,
      description,
      dueDate,
    })

    if ('error' in result && result.error) {
      return {
        action,
        success: false,
        message: String(result.error),
        error: String(result.error),
        durationMs: Date.now() - start,
      }
    }

    return {
      action,
      success: true,
      message: `Created draft invoice for ${leadName} — $${amount.toFixed(2)}`,
      data: { invoiceId: result.invoiceId, leadName: result.leadName },
      durationMs: Date.now() - start,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { action, success: false, message, error: message, durationMs: Date.now() - start }
  }
}

async function executeFlagOverdueInvoice(
  action: AgentAction,
  context: AgentContext,
  convex: ConvexHttpClient
): Promise<ActionResult> {
  const start = Date.now()
  try {
    const notes = String(action.params.notes ?? '').trim()
    if (!notes) {
      return {
        action,
        success: true,
        message: `Skipped empty overdue flag for lead ${action.target}`,
        durationMs: Date.now() - start,
      }
    }

    const invoiceId = String(action.params.invoiceId ?? action.target).trim()
    if (!invoiceId) {
      return {
        action,
        success: false,
        message: 'Missing invoice id for overdue flag action',
        error: 'Missing invoice id',
        durationMs: Date.now() - start,
      }
    }

    const { api } = await getApi()
    const result = await convex.mutation(api.invoices.flagOverdueInvoiceById, {
      userId: asAppUserId(context.userId),
      organizationId: asOrganizationId(context.organizationId),
      invoiceId: asInvoiceId(invoiceId),
      notes,
    })

    return {
      action,
      success: true,
      message: String(result.message ?? `Flagged overdue invoice ${invoiceId}`),
      durationMs: Date.now() - start,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { action, success: false, message, error: message, durationMs: Date.now() - start }
  }
}

async function executeLogInvoiceRecommendation(
  action: AgentAction,
  _context: AgentContext,
  _convex: ConvexHttpClient
): Promise<ActionResult> {
  const start = Date.now()
  const recommendation = String(action.params.recommendation ?? '')
  const priority = String(action.params.priority ?? 'medium')

  console.info('[Agent:Invoice] Recommendation logged', {
    target: action.target,
    priority,
    hasRecommendation: recommendation.length > 0,
  })

  return {
    action,
    success: true,
    message: `Logged invoice recommendation for ${action.target}`,
    data: { recommendation, priority },
    durationMs: Date.now() - start,
  }
}

async function executeUpdateInvoiceStatus(
  action: AgentAction,
  context: AgentContext,
  convex: ConvexHttpClient
): Promise<ActionResult> {
  const start = Date.now()
  try {
    const status = String(action.params.status ?? '').trim()
    if (!['draft', 'sent', 'paid'].includes(status)) {
      return {
        action,
        success: false,
        message: `Invalid invoice status: ${status || '<empty>'}`,
        error: `Invalid invoice status: ${status || '<empty>'}`,
        durationMs: Date.now() - start,
      }
    }

    const { api } = await getApi()
    await convex.mutation(api.invoices.update, {
      userId: asAppUserId(context.userId),
      organizationId: asOrganizationId(context.organizationId),
      id: asInvoiceId(action.target),
      status: status as 'draft' | 'sent' | 'paid',
    })

    return {
      action,
      success: true,
      message: `Updated invoice ${action.target} to "${status}"`,
      durationMs: Date.now() - start,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { action, success: false, message, error: message, durationMs: Date.now() - start }
  }
}

/**
 * Dispatch an invoice action to the appropriate executor.
 */
export async function executeInvoiceAction(
  action: AgentAction,
  context: AgentContext,
  convex: ConvexHttpClient
): Promise<ActionResult> {
  switch (action.type) {
    case 'create_invoice':
      return executeCreateInvoice(action, context, convex)
    case 'flag_overdue_invoice':
      return executeFlagOverdueInvoice(action, context, convex)
    case 'log_invoice_recommendation':
      return executeLogInvoiceRecommendation(action, context, convex)
    case 'update_invoice_status':
      return executeUpdateInvoiceStatus(action, context, convex)
    default:
      return {
        action,
        success: false,
        message: `Unknown action type: ${action.type}`,
        error: `Unknown action type: ${action.type}`,
        durationMs: 0,
      }
  }
}

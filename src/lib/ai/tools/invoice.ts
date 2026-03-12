import { tool } from 'ai'
import { ConvexHttpClient } from 'convex/browser'
import { addDays, format } from 'date-fns'
import { z } from 'zod'
import { asAppUserId, asOrganizationId, getApi } from '../shared/convex'
import type { ToolContext, ToolResult } from './index'

interface InvoiceCreatedResult {
  invoiceId: string
  leadName: string
  amount: number
}

interface InvoiceListItem {
  leadName: string
  amount: number
  status: 'draft' | 'sent' | 'paid'
  description?: string
  dueDate?: string
  createdAt: number
}

interface InvoiceStatsResult {
  total: number
  byStatus: Record<string, number>
  totalAmount: number
  paidAmount: number
  pendingAmount: number
}

interface InvoicePaidResult {
  invoiceId: string
  leadName: string
  amount: number
}

/**
 * Create invoice tools for the chat AI.
 *
 * These let the user create invoices, list them, check stats,
 * and mark invoices as paid through natural conversation.
 */
export function createInvoiceTools(ctx: ToolContext) {
  const convex = ctx.convexClient ?? new ConvexHttpClient(ctx.convexUrl)
  const orgId = asOrganizationId(ctx.organizationId)
  const userId = asAppUserId(ctx.userId)

  return {
    createInvoice: tool({
      description:
        'Create a new invoice for a client/lead. Creates a draft invoice that can later be sent. Use when the user says "invoice Sarah $500" or "create an invoice for John".',
      inputSchema: z.object({
        leadName: z.string().describe('Name of the lead/client to invoice (will fuzzy match)'),
        amount: z.number().describe('Invoice amount in dollars'),
        description: z
          .string()
          .optional()
          .describe('Service description, e.g. "Portrait photography session"'),
        dueDate: z
          .string()
          .optional()
          .describe('Due date in YYYY-MM-DD format. Defaults to 30 days from now if omitted.'),
      }),
      execute: async (args): Promise<ToolResult<InvoiceCreatedResult>> => {
        try {
          const dueDate = args.dueDate ?? format(addDays(new Date(), 30), 'yyyy-MM-dd')
          const { api } = await getApi()
          const result = await convex.mutation(api.invoices.createByLeadName, {
            userId,
            organizationId: orgId,
            leadName: args.leadName,
            amount: args.amount,
            description: args.description,
            dueDate,
          })

          if ('error' in result && result.error) {
            return { success: false, error: result.error as string }
          }

          return {
            success: true,
            data: {
              invoiceId: String(result.invoiceId),
              leadName: result.leadName as string,
              amount: args.amount,
            },
            message: result.message as string,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to create invoice: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    listInvoices: tool({
      description:
        'List invoices, optionally filtered by status. Use when the user asks "show my invoices", "what invoices are unpaid?", or "list draft invoices".',
      inputSchema: z.object({
        status: z
          .enum(['draft', 'sent', 'paid'])
          .optional()
          .describe('Filter by invoice status. Omit to show all invoices.'),
      }),
      execute: async (
        args
      ): Promise<ToolResult<{ invoices: InvoiceListItem[]; count: number }>> => {
        try {
          const { api } = await getApi()
          const invoices = (await convex.query(api.invoices.list, {
            userId,
            organizationId: orgId,
            status: args.status,
            limit: 50,
          })) as Array<{
            leadName: string
            amount: number
            status: 'draft' | 'sent' | 'paid'
            description?: string
            dueDate?: string
            createdAt: number
          }>

          const items: InvoiceListItem[] = invoices.map((i) => ({
            leadName: i.leadName,
            amount: i.amount,
            status: i.status,
            description: i.description,
            dueDate: i.dueDate,
            createdAt: i.createdAt,
          }))

          return {
            success: true,
            data: { invoices: items, count: items.length },
            message:
              items.length > 0
                ? `Found ${items.length} invoice(s)${args.status ? ` with status "${args.status}"` : ''}.`
                : `No invoices found${args.status ? ` with status "${args.status}"` : ''}.`,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to list invoices: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    getInvoiceStats: tool({
      description:
        'Get invoice statistics including totals, amounts by status, and revenue. Use when the user asks "how much revenue?", "invoice summary", or "what\'s my billing status?".',
      inputSchema: z.object({}),
      execute: async (): Promise<ToolResult<InvoiceStatsResult>> => {
        try {
          const { api } = await getApi()
          const stats = (await convex.query(api.invoices.getStats, {
            userId,
            organizationId: orgId,
          })) as InvoiceStatsResult

          return {
            success: true,
            data: stats,
            message: `${stats.total} invoices — $${stats.paidAmount.toFixed(2)} paid, $${stats.pendingAmount.toFixed(2)} pending.`,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to get stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    markInvoicePaid: tool({
      description:
        'Mark an invoice as paid by lead/client name. Finds the most recent unpaid invoice for that lead and marks it as paid. Use when the user says "Sarah paid" or "mark John\'s invoice as paid".',
      inputSchema: z.object({
        leadName: z
          .string()
          .describe('Name of the lead/client whose invoice to mark as paid (will fuzzy match)'),
      }),
      execute: async (args): Promise<ToolResult<InvoicePaidResult>> => {
        try {
          const { api } = await getApi()
          const result = await convex.mutation(api.invoices.markAsPaidByLeadName, {
            userId,
            organizationId: orgId,
            leadName: args.leadName,
          })

          if ('error' in result && result.error) {
            return { success: false, error: result.error as string }
          }

          return {
            success: true,
            data: {
              invoiceId: String(result.invoiceId),
              leadName: result.leadName as string,
              amount: result.amount as number,
            },
            message: result.message as string,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to mark invoice as paid: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),
  }
}

export type InvoiceTools = ReturnType<typeof createInvoiceTools>

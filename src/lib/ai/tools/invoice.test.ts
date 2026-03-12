import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createInvoiceTools } from './invoice'

function makeMockCtx(overrides: {
  mutationResult?: Record<string, unknown>
  queryResult?: unknown[] | Record<string, unknown>
  shouldThrow?: boolean
}) {
  return {
    organizationId: 'org_test123',
    userId: 'user_test123',
    convexUrl: 'https://fake.convex.cloud',
    convexClient: {
      mutation: async () => {
        if (overrides.shouldThrow) throw new Error('Network failure')
        return overrides.mutationResult ?? {}
      },
      query: async () => {
        if (overrides.shouldThrow) throw new Error('Network failure')
        return overrides.queryResult ?? []
      },
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper to bypass AI SDK generics
type AnyResult = any

async function execCreateInvoice(
  tools: ReturnType<typeof createInvoiceTools>,
  args: { leadName: string; amount: number; description?: string; dueDate?: string }
): Promise<AnyResult> {
  const exec = tools.createInvoice.execute
  if (!exec) throw new Error('createInvoice.execute is undefined')
  return exec(args, { toolCallId: 'tc_1', messages: [], abortSignal: undefined as never })
}

async function execListInvoices(
  tools: ReturnType<typeof createInvoiceTools>,
  args: { status?: 'draft' | 'sent' | 'paid' } = {}
): Promise<AnyResult> {
  const exec = tools.listInvoices.execute
  if (!exec) throw new Error('listInvoices.execute is undefined')
  return exec(args, { toolCallId: 'tc_1', messages: [], abortSignal: undefined as never })
}

async function execGetInvoiceStats(
  tools: ReturnType<typeof createInvoiceTools>
): Promise<AnyResult> {
  const exec = tools.getInvoiceStats.execute
  if (!exec) throw new Error('getInvoiceStats.execute is undefined')
  return exec({}, { toolCallId: 'tc_1', messages: [], abortSignal: undefined as never })
}

async function execMarkInvoicePaid(
  tools: ReturnType<typeof createInvoiceTools>,
  args: { leadName: string }
): Promise<AnyResult> {
  const exec = tools.markInvoicePaid.execute
  if (!exec) throw new Error('markInvoicePaid.execute is undefined')
  return exec(args, { toolCallId: 'tc_1', messages: [], abortSignal: undefined as never })
}

describe('createInvoiceTools', () => {
  it('returns all four invoice tools', () => {
    const tools = createInvoiceTools(makeMockCtx({}) as never)
    assert.ok(tools.createInvoice, 'createInvoice tool exists')
    assert.ok(tools.listInvoices, 'listInvoices tool exists')
    assert.ok(tools.getInvoiceStats, 'getInvoiceStats tool exists')
    assert.ok(tools.markInvoicePaid, 'markInvoicePaid tool exists')
  })

  it('createInvoice has correct description', () => {
    const tools = createInvoiceTools(makeMockCtx({}) as never)
    const desc = tools.createInvoice.description
    assert.ok(desc?.includes('invoice'), 'description mentions invoice')
    assert.ok(desc?.includes('draft'), 'description mentions draft')
  })

  it('markInvoicePaid has correct description', () => {
    const tools = createInvoiceTools(makeMockCtx({}) as never)
    const desc = tools.markInvoicePaid.description
    assert.ok(desc?.includes('paid'), 'description mentions paid')
  })
})

describe('createInvoice execute', () => {
  it('returns success when mutation succeeds', async () => {
    const ctx = makeMockCtx({
      mutationResult: {
        success: true,
        invoiceId: 'inv_123',
        leadName: 'Sarah Johnson',
        leadId: 'lead_456',
        message: 'Invoice #inv_12 created for Sarah Johnson - $500',
      },
    })

    const tools = createInvoiceTools(ctx as never)
    const result = await execCreateInvoice(tools, {
      leadName: 'Sarah Johnson',
      amount: 500,
      description: 'Portrait session',
    })

    assert.equal(result.success, true)
    assert.equal(result.data?.leadName, 'Sarah Johnson')
    assert.equal(result.data?.amount, 500)
    assert.ok(result.message?.includes('Invoice'))
  })

  it('returns error when lead not found', async () => {
    const ctx = makeMockCtx({
      mutationResult: {
        success: false,
        error: 'Lead not found',
      },
    })

    const tools = createInvoiceTools(ctx as never)
    const result = await execCreateInvoice(tools, {
      leadName: 'Unknown Person',
      amount: 100,
    })

    assert.equal(result.success, false)
    assert.ok(result.error.includes('Lead not found'))
  })

  it('handles network errors gracefully', async () => {
    const ctx = makeMockCtx({ shouldThrow: true })

    const tools = createInvoiceTools(ctx as never)
    const result = await execCreateInvoice(tools, {
      leadName: 'Anyone',
      amount: 100,
    })

    assert.equal(result.success, false)
    assert.ok(result.error.includes('Network failure'))
  })
})

describe('listInvoices execute', () => {
  it('returns formatted invoices from query results', async () => {
    const ctx = makeMockCtx({
      queryResult: [
        {
          leadName: 'Alice',
          amount: 500,
          status: 'draft',
          description: 'Photo session',
          createdAt: Date.now(),
        },
        {
          leadName: 'Bob',
          amount: 300,
          status: 'paid',
          description: 'Editing',
          dueDate: '2026-04-01',
          createdAt: Date.now(),
        },
      ],
    })

    const tools = createInvoiceTools(ctx as never)
    const result = await execListInvoices(tools)

    assert.equal(result.success, true)
    assert.equal(result.data?.count, 2)
    assert.equal(result.data?.invoices[0].leadName, 'Alice')
    assert.equal(result.data?.invoices[1].status, 'paid')
  })

  it('returns empty list when no invoices exist', async () => {
    const ctx = makeMockCtx({ queryResult: [] })

    const tools = createInvoiceTools(ctx as never)
    const result = await execListInvoices(tools)

    assert.equal(result.success, true)
    assert.equal(result.data?.count, 0)
    assert.ok(result.message?.includes('No invoices'))
  })

  it('handles query errors gracefully', async () => {
    const ctx = makeMockCtx({ shouldThrow: true })

    const tools = createInvoiceTools(ctx as never)
    const result = await execListInvoices(tools)

    assert.equal(result.success, false)
    assert.ok(result.error.includes('Network failure'))
  })
})

describe('getInvoiceStats execute', () => {
  it('returns stats with formatted message', async () => {
    const ctx = makeMockCtx({
      queryResult: {
        total: 5,
        byStatus: { draft: 1, sent: 2, paid: 2 },
        totalAmount: 2500,
        paidAmount: 1000,
        pendingAmount: 1500,
      },
    })

    const tools = createInvoiceTools(ctx as never)
    const result = await execGetInvoiceStats(tools)

    assert.equal(result.success, true)
    assert.equal(result.data?.total, 5)
    assert.equal(result.data?.paidAmount, 1000)
    assert.ok(result.message?.includes('$1000.00'))
  })

  it('handles query errors gracefully', async () => {
    const ctx = makeMockCtx({ shouldThrow: true })

    const tools = createInvoiceTools(ctx as never)
    const result = await execGetInvoiceStats(tools)

    assert.equal(result.success, false)
    assert.ok(result.error.includes('Network failure'))
  })
})

describe('markInvoicePaid execute', () => {
  it('returns success when mutation succeeds', async () => {
    const ctx = makeMockCtx({
      mutationResult: {
        success: true,
        invoiceId: 'inv_789',
        leadName: 'Sarah',
        amount: 500,
        message: 'Invoice for Sarah marked as paid — $500.00',
      },
    })

    const tools = createInvoiceTools(ctx as never)
    const result = await execMarkInvoicePaid(tools, { leadName: 'Sarah' })

    assert.equal(result.success, true)
    assert.equal(result.data?.leadName, 'Sarah')
    assert.equal(result.data?.amount, 500)
    assert.ok(result.message?.includes('paid'))
  })

  it('returns error when no unpaid invoice found', async () => {
    const ctx = makeMockCtx({
      mutationResult: {
        success: false,
        error: 'No unpaid invoice found for Unknown',
      },
    })

    const tools = createInvoiceTools(ctx as never)
    const result = await execMarkInvoicePaid(tools, { leadName: 'Unknown' })

    assert.equal(result.success, false)
    assert.ok(result.error.includes('No unpaid invoice'))
  })

  it('handles network errors gracefully', async () => {
    const ctx = makeMockCtx({ shouldThrow: true })

    const tools = createInvoiceTools(ctx as never)
    const result = await execMarkInvoicePaid(tools, { leadName: 'Anyone' })

    assert.equal(result.success, false)
    assert.ok(result.error.includes('Network failure'))
  })
})

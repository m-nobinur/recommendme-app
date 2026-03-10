import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  create,
  createByLeadName,
  flagOverdueInvoiceById,
  getCompletedAppointmentsWithoutInvoice,
  update,
} from './invoices'

function createBaseUser() {
  return { _id: 'user_1', organizationId: 'org_1' }
}

describe('invoices amount validation', () => {
  it('rejects non-positive amounts for create', async () => {
    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === 'user_1') return createBaseUser()
          if (id === 'lead_1') return { _id: 'lead_1', organizationId: 'org_1', name: 'Sarah' }
          return null
        },
      },
    }

    await assert.rejects(
      () =>
        (create as any)._handler(ctx, {
          organizationId: 'org_1',
          userId: 'user_1',
          leadId: 'lead_1',
          leadName: 'Sarah',
          amount: 0,
        }),
      /positive number/
    )
  })

  it('rejects non-positive amounts for createByLeadName and update(amount)', async () => {
    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === 'user_1') return createBaseUser()
          if (id === 'inv_1')
            return { _id: 'inv_1', organizationId: 'org_1', status: 'draft', amount: 100 }
          return null
        },
        query: () => ({
          withIndex: () => ({
            take: async () => [
              { _id: 'lead_1', organizationId: 'org_1', name: 'Sarah', status: 'New' },
            ],
          }),
        }),
      },
    }

    await assert.rejects(
      () =>
        (createByLeadName as any)._handler(ctx, {
          organizationId: 'org_1',
          userId: 'user_1',
          leadName: 'Sarah',
          amount: -25,
        }),
      /positive number/
    )

    await assert.rejects(
      () =>
        (update as any)._handler(ctx, {
          organizationId: 'org_1',
          userId: 'user_1',
          id: 'inv_1',
          amount: -10,
        }),
      /positive number/
    )
  })
})

describe('invoices.createByLeadName behavior', () => {
  it('does not regress mature lead statuses and ignores empty item names', async () => {
    let insertedItems: unknown = null
    const patches: Array<{ id: string; values: Record<string, unknown> }> = []
    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === 'user_1') return createBaseUser()
          return null
        },
        query: () => ({
          withIndex: () => ({
            take: async () => [
              { _id: 'lead_1', organizationId: 'org_1', name: 'Sarah', status: 'Closed' },
            ],
          }),
        }),
        insert: async (_table: string, doc: Record<string, unknown>) => {
          insertedItems = doc['items']
          return 'inv_1'
        },
        patch: async (id: string, values: Record<string, unknown>) => {
          patches.push({ id, values })
        },
      },
    }

    const result = await (createByLeadName as any)._handler(ctx, {
      organizationId: 'org_1',
      userId: 'user_1',
      leadName: 'Sarah',
      amount: 300,
      items: ['   ', ''],
    })

    assert.equal(result.success, true)
    assert.equal(insertedItems, undefined)
    assert.equal(patches.length, 0)
  })

  it('promotes early-stage lead statuses to Proposal', async () => {
    const patches: Array<{ id: string; values: Record<string, unknown> }> = []
    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === 'user_1') return createBaseUser()
          return null
        },
        query: () => ({
          withIndex: () => ({
            take: async () => [
              { _id: 'lead_1', organizationId: 'org_1', name: 'Sarah', status: 'Qualified' },
            ],
          }),
        }),
        insert: async () => 'inv_1',
        patch: async (id: string, values: Record<string, unknown>) => {
          patches.push({ id, values })
        },
      },
    }

    await (createByLeadName as any)._handler(ctx, {
      organizationId: 'org_1',
      userId: 'user_1',
      leadName: 'Sarah',
      amount: 300,
      items: ['Session fee'],
    })

    assert.equal(patches.length, 1)
    assert.equal(patches[0].id, 'lead_1')
    assert.equal(patches[0].values.status, 'Proposal')
  })
})

describe('invoices.getCompletedAppointmentsWithoutInvoice', () => {
  it('keeps uninvoiced completed appointments for leads that already have some invoices', async () => {
    const completedAppointments = [
      {
        _id: 'appt_newer',
        leadId: 'lead_a',
        leadName: 'Lead A',
        date: '2026-03-11',
        time: '11:00',
        title: 'Second session',
        status: 'completed',
      },
      {
        _id: 'appt_older',
        leadId: 'lead_a',
        leadName: 'Lead A',
        date: '2026-03-10',
        time: '10:00',
        title: 'First session',
        status: 'completed',
      },
      {
        _id: 'appt_b',
        leadId: 'lead_b',
        leadName: 'Lead B',
        date: '2026-03-09',
        time: '09:00',
        title: 'Consult',
        status: 'completed',
      },
    ]
    const invoices = [{ _id: 'inv_1', leadId: 'lead_a' }]

    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: () => ({
            order: () => ({
              take: async () => (table === 'appointments' ? completedAppointments : invoices),
            }),
            take: async () => (table === 'appointments' ? completedAppointments : invoices),
          }),
        }),
      },
    }

    const results = await (getCompletedAppointmentsWithoutInvoice as any)._handler(ctx, {
      organizationId: 'org_1',
      maxResults: 20,
    })

    assert.equal(results.length, 2)
    assert.equal(
      results.some((item: { id: string }) => item.id === 'appt_newer'),
      true
    )
    assert.equal(
      results.some((item: { id: string }) => item.id === 'appt_b'),
      true
    )
  })
})

describe('invoices.flagOverdueInvoiceById', () => {
  it('is idempotent for same-day note markers', async () => {
    const lead = {
      _id: 'lead_1',
      organizationId: 'org_1',
      notes: undefined as string | undefined,
    }
    const invoice = {
      _id: 'inv_1',
      organizationId: 'org_1',
      leadId: 'lead_1',
    }
    const patches: Array<Record<string, unknown>> = []

    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === 'user_1') return createBaseUser()
          if (id === 'inv_1') return invoice
          if (id === 'lead_1') return lead
          return null
        },
        patch: async (_id: string, values: Record<string, unknown>) => {
          patches.push(values)
          if (typeof values.notes === 'string') {
            lead.notes = values.notes
          }
        },
      },
    }

    const first = await (flagOverdueInvoiceById as any)._handler(ctx, {
      organizationId: 'org_1',
      userId: 'user_1',
      invoiceId: 'inv_1',
      notes: 'Payment is overdue by 9 days',
    })
    const second = await (flagOverdueInvoiceById as any)._handler(ctx, {
      organizationId: 'org_1',
      userId: 'user_1',
      invoiceId: 'inv_1',
      notes: 'Payment is overdue by 9 days',
    })

    assert.equal(first.success, true)
    assert.equal(second.success, true)
    assert.equal(patches.length, 1)
  })
})

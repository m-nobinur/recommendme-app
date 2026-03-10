import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { create, list, listByLead, remove } from './appointments'

interface MockState {
  deletedIds: string[]
}

function createMockCtx(options: {
  user: { _id: string; organizationId: string } | null
  appointment: { _id: string; organizationId: string } | null
}) {
  const state: MockState = { deletedIds: [] }
  const { user, appointment } = options

  const db = {
    get: async (id: string) => {
      if (user && id === user._id) return user
      if (appointment && id === appointment._id) return appointment
      return null
    },
    delete: async (id: string) => {
      state.deletedIds.push(id)
    },
  }

  return { db, state }
}

describe('appointments.remove', () => {
  it('rejects when user is not in the organization', async () => {
    const ctx = createMockCtx({
      user: null,
      appointment: { _id: 'appt_1', organizationId: 'org_1' },
    })

    await assert.rejects(
      () =>
        (remove as any)._handler(ctx, {
          userId: 'user_1',
          organizationId: 'org_1',
          id: 'appt_1',
        }),
      /Access denied/
    )
    assert.equal(ctx.state.deletedIds.length, 0)
  })

  it('rejects cross-organization deletes', async () => {
    const ctx = createMockCtx({
      user: { _id: 'user_1', organizationId: 'org_1' },
      appointment: { _id: 'appt_1', organizationId: 'org_2' },
    })

    await assert.rejects(
      () =>
        (remove as any)._handler(ctx, {
          userId: 'user_1',
          organizationId: 'org_1',
          id: 'appt_1',
        }),
      /Appointment not found or access denied/
    )
    assert.equal(ctx.state.deletedIds.length, 0)
  })

  it('deletes when user and appointment belong to the same organization', async () => {
    const ctx = createMockCtx({
      user: { _id: 'user_1', organizationId: 'org_1' },
      appointment: { _id: 'appt_1', organizationId: 'org_1' },
    })

    const result = await (remove as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      id: 'appt_1',
    })

    assert.deepEqual(result, { success: true })
    assert.deepEqual(ctx.state.deletedIds, ['appt_1'])
  })
})

describe('appointments.create', () => {
  it('rejects when lead is missing or from another organization', async () => {
    const ctx = createMockCtx({
      user: { _id: 'user_1', organizationId: 'org_1' },
      appointment: null,
    })
    const baseDb = ctx.db as any
    baseDb.insert = async () => 'appt_new'

    await assert.rejects(
      () =>
        (create as any)._handler(
          {
            db: {
              ...baseDb,
              get: async (id: string) => {
                if (id === 'user_1') return { _id: 'user_1', organizationId: 'org_1' }
                if (id === 'lead_1')
                  return { _id: 'lead_1', organizationId: 'org_2', name: 'Wrong Org' }
                return null
              },
            },
          },
          {
            userId: 'user_1',
            organizationId: 'org_1',
            leadId: 'lead_1',
            leadName: 'Ignored',
            date: '2026-03-10',
            time: '10:00',
          }
        ),
      /Lead not found or access denied/
    )
  })

  it('uses canonical lead name from the lead record', async () => {
    let insertedDoc: Record<string, unknown> = {}
    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === 'user_1') return { _id: 'user_1', organizationId: 'org_1' }
          if (id === 'lead_1') return { _id: 'lead_1', organizationId: 'org_1', name: 'Real Name' }
          return null
        },
        insert: async (_table: string, doc: Record<string, unknown>) => {
          insertedDoc = doc
          return 'appt_new'
        },
      },
    }

    const result = await (create as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      leadId: 'lead_1',
      leadName: 'Spoofed Name',
      date: '2026-03-10',
      time: '10:00',
    })

    assert.equal(result, 'appt_new')
    assert.equal(insertedDoc.leadName, 'Real Name')
    assert.equal(insertedDoc.title, 'Appointment with Real Name')
  })
})

describe('appointments.listByLead', () => {
  it('filters out cross-organization appointments', async () => {
    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === 'user_1') return { _id: 'user_1', organizationId: 'org_1' }
          if (id === 'lead_1') return { _id: 'lead_1', organizationId: 'org_1' }
          return null
        },
        query: () => ({
          withIndex: () => ({
            order: () => ({
              collect: async () => [
                { _id: 'appt_1', organizationId: 'org_1', leadId: 'lead_1' },
                { _id: 'appt_2', organizationId: 'org_2', leadId: 'lead_1' },
              ],
            }),
          }),
        }),
      },
    }

    const results = await (listByLead as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      leadId: 'lead_1',
    })

    assert.equal(results.length, 1)
    assert.equal(results[0]._id, 'appt_1')
  })
})

describe('appointments.list performance', () => {
  interface ListTestAppointment {
    _id: string
    organizationId: string
    leadId: string
    leadName: string
    date: string
    time: string
    status: 'scheduled' | 'completed' | 'cancelled'
    [key: string]: unknown
  }

  function createListCtx(appointments: ListTestAppointment[]) {
    const calls = {
      indexes: [] as string[],
      usedTake: false,
      usedCollect: false,
      usedPaginate: false,
    }

    const db = {
      get: async (id: string) => {
        if (id === 'user_1') return { _id: 'user_1', organizationId: 'org_1' }
        return null
      },
      query: (_table: string) => ({
        withIndex: (
          indexName: string,
          selector: (q: {
            eq: (field: string, value: string) => any
            gte: (field: string, value: string) => any
            lte: (field: string, value: string) => any
          }) => any
        ) => {
          calls.indexes.push(indexName)

          const filters: Array<{ op: 'eq' | 'gte' | 'lte'; field: string; value: string }> = []
          const q = {
            eq: (field: string, value: string) => {
              filters.push({ op: 'eq', field, value })
              return q
            },
            gte: (field: string, value: string) => {
              filters.push({ op: 'gte', field, value })
              return q
            },
            lte: (field: string, value: string) => {
              filters.push({ op: 'lte', field, value })
              return q
            },
          }

          selector(q)

          const filtered = appointments.filter((appointment) =>
            filters.every((filter) => {
              const fieldValue = String(
                (appointment as Record<string, unknown>)[filter.field] ?? ''
              )
              if (filter.op === 'eq') return fieldValue === filter.value
              if (filter.op === 'gte') return fieldValue >= filter.value
              return fieldValue <= filter.value
            })
          )

          return {
            order: (_direction: 'asc' | 'desc') => ({
              take: async (count: number) => {
                calls.usedTake = true
                return filtered.slice(0, count)
              },
              collect: async () => {
                calls.usedCollect = true
                return filtered
              },
              paginate: async ({
                numItems,
                cursor,
              }: {
                numItems: number
                cursor: string | null
              }) => {
                calls.usedPaginate = true
                const start = cursor ? Number.parseInt(cursor, 10) : 0
                const safeStart = Number.isNaN(start) ? 0 : start
                const page = filtered.slice(safeStart, safeStart + numItems)
                const nextOffset = safeStart + page.length
                return {
                  page,
                  isDone: nextOffset >= filtered.length,
                  continueCursor: String(nextOffset),
                }
              },
            }),
          }
        },
      }),
    }

    return { db, calls }
  }

  it('uses by_org_status index and take() for status + limit queries', async () => {
    const ctx = createListCtx([
      {
        _id: 'appt_1',
        organizationId: 'org_1',
        leadId: 'lead_1',
        leadName: 'A',
        date: '2026-03-10',
        time: '10:00',
        status: 'scheduled',
      },
      {
        _id: 'appt_2',
        organizationId: 'org_1',
        leadId: 'lead_2',
        leadName: 'B',
        date: '2026-03-11',
        time: '11:00',
        status: 'scheduled',
      },
      {
        _id: 'appt_3',
        organizationId: 'org_1',
        leadId: 'lead_3',
        leadName: 'C',
        date: '2026-03-12',
        time: '12:00',
        status: 'completed',
      },
    ])

    const results = await (list as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      status: 'scheduled',
      limit: 1,
    })

    assert.equal(ctx.calls.indexes[0], 'by_org_status')
    assert.equal(ctx.calls.usedTake, true)
    assert.equal(ctx.calls.usedCollect, false)
    assert.equal(results.length, 1)
    assert.equal(results[0].status, 'scheduled')
  })

  it('uses by_org_date index for date-range queries', async () => {
    const ctx = createListCtx([
      {
        _id: 'appt_1',
        organizationId: 'org_1',
        leadId: 'lead_1',
        leadName: 'A',
        date: '2026-03-01',
        time: '09:00',
        status: 'scheduled',
      },
      {
        _id: 'appt_2',
        organizationId: 'org_1',
        leadId: 'lead_2',
        leadName: 'B',
        date: '2026-03-15',
        time: '11:00',
        status: 'scheduled',
      },
    ])

    const results = await (list as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      startDate: '2026-03-10',
      endDate: '2026-03-31',
    })

    assert.equal(ctx.calls.indexes[0], 'by_org_date')
    assert.equal(results.length, 1)
    assert.equal(results[0]._id, 'appt_2')
  })

  it('returns correct status matches with date range + limit', async () => {
    const skewedAppointments = Array.from({ length: 120 }, (_, index) => ({
      _id: `appt_${index}`,
      organizationId: 'org_1',
      leadId: 'lead_1',
      leadName: `Lead ${index}`,
      date: '2026-03-15',
      time: '10:00',
      status: index < 90 ? 'scheduled' : 'completed',
    })) as ListTestAppointment[]

    const ctx = createListCtx(skewedAppointments)
    const results = await (list as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      startDate: '2026-03-10',
      endDate: '2026-03-20',
      status: 'completed',
      limit: 5,
    })

    assert.equal(ctx.calls.indexes[0], 'by_org_date')
    assert.equal(ctx.calls.usedPaginate, true)
    assert.equal(results.length, 5)
    assert.ok(
      results.every((appointment: ListTestAppointment) => appointment.status === 'completed')
    )
  })

  it('uses paginate (not collect) for date range + status without limit', async () => {
    const appointments = Array.from({ length: 75 }, (_, index) => ({
      _id: `appt_${index}`,
      organizationId: 'org_1',
      leadId: 'lead_1',
      leadName: `Lead ${index}`,
      date: '2026-03-15',
      time: '10:00',
      status: index % 2 === 0 ? 'scheduled' : 'completed',
    })) as ListTestAppointment[]

    const ctx = createListCtx(appointments)
    const results = await (list as any)._handler(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      startDate: '2026-03-10',
      endDate: '2026-03-20',
      status: 'completed',
    })

    assert.equal(ctx.calls.indexes[0], 'by_org_date')
    assert.equal(ctx.calls.usedPaginate, true)
    assert.equal(ctx.calls.usedCollect, false)
    assert.equal(
      results.filter((appointment: ListTestAppointment) => appointment.status !== 'completed')
        .length,
      0
    )
  })
})

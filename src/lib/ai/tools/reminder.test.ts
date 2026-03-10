import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createReminderTools } from './reminder'

function makeMockCtx(overrides: {
  mutationResult?: Record<string, unknown>
  queryResult?: unknown[]
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

async function execSetReminder(
  tools: ReturnType<typeof createReminderTools>,
  args: { leadName: string; date?: string; reminderMessage: string }
): Promise<AnyResult> {
  const exec = tools.setReminder.execute
  if (!exec) throw new Error('setReminder.execute is undefined')
  return exec(args, { toolCallId: 'tc_1', messages: [], abortSignal: undefined as never })
}

async function execListReminders(
  tools: ReturnType<typeof createReminderTools>
): Promise<AnyResult> {
  const exec = tools.listReminders.execute
  if (!exec) throw new Error('listReminders.execute is undefined')
  return exec({}, { toolCallId: 'tc_1', messages: [], abortSignal: undefined as never })
}

describe('createReminderTools', () => {
  it('returns setReminder and listReminders tools', () => {
    const tools = createReminderTools(makeMockCtx({}) as never)
    assert.ok(tools.setReminder, 'setReminder tool exists')
    assert.ok(tools.listReminders, 'listReminders tool exists')
  })

  it('setReminder has correct description and schema', () => {
    const tools = createReminderTools(makeMockCtx({}) as never)
    const desc = tools.setReminder.description
    assert.ok(desc?.includes('reminder'), 'description mentions reminder')
    assert.ok(desc?.includes('appointment'), 'description mentions appointment')
  })

  it('listReminders has correct description', () => {
    const tools = createReminderTools(makeMockCtx({}) as never)
    const desc = tools.listReminders.description
    assert.ok(desc?.includes('reminder'), 'description mentions reminder')
  })
})

describe('setReminder execute', () => {
  it('returns success when mutation succeeds', async () => {
    const ctx = makeMockCtx({
      mutationResult: {
        success: true,
        appointmentId: 'appt_123',
        leadName: 'John Doe',
        date: '2026-03-10',
        time: '14:00',
        title: 'Meeting',
        message: 'Reminder set for appointment with John Doe on 2026-03-10 at 14:00',
      },
    })

    const tools = createReminderTools(ctx as never)
    const result = await execSetReminder(tools, {
      leadName: 'John Doe',
      reminderMessage: 'Bring samples',
    })

    assert.equal(result.success, true)
    assert.equal(result.data?.leadName, 'John Doe')
    assert.equal(result.data?.date, '2026-03-10')
    assert.ok(result.message?.includes('Reminder set'))
  })

  it('returns error when appointment not found', async () => {
    const ctx = makeMockCtx({
      mutationResult: {
        success: false,
        error: 'No upcoming scheduled appointment found with Jane',
      },
    })

    const tools = createReminderTools(ctx as never)
    const result = await execSetReminder(tools, {
      leadName: 'Jane',
      reminderMessage: 'Call ahead',
    })

    assert.equal(result.success, false)
    assert.ok(result.error.includes('Jane'))
  })

  it('handles network errors gracefully', async () => {
    const ctx = makeMockCtx({ shouldThrow: true })

    const tools = createReminderTools(ctx as never)
    const result = await execSetReminder(tools, {
      leadName: 'Anyone',
      reminderMessage: 'Test',
    })

    assert.equal(result.success, false)
    assert.ok(result.error.includes('Network failure'))
  })
})

describe('listReminders execute', () => {
  it('returns formatted reminders from query results', async () => {
    const ctx = makeMockCtx({
      queryResult: [
        {
          leadName: 'Alice',
          date: '2026-03-10',
          time: '10:00',
          title: 'Consultation',
          notes: '[Reminder 2026-03-09] Prepare contract\n[Reminder 2026-03-09] Call ahead',
        },
        {
          leadName: 'Bob',
          date: '2026-03-11',
          time: '15:00',
          notes: '[Reminder 2026-03-09] Confirm location',
        },
      ],
    })

    const tools = createReminderTools(ctx as never)
    const result = await execListReminders(tools)

    assert.equal(result.success, true)
    assert.equal(result.data?.count, 2)
    assert.equal(result.data?.reminders[0].leadName, 'Alice')
    assert.equal(result.data?.reminders[0].reminderNotes.length, 2)
    assert.equal(result.data?.reminders[1].reminderNotes.length, 1)
  })

  it('returns empty list when no reminders exist', async () => {
    const ctx = makeMockCtx({ queryResult: [] })

    const tools = createReminderTools(ctx as never)
    const result = await execListReminders(tools)

    assert.equal(result.success, true)
    assert.equal(result.data?.count, 0)
    assert.ok(result.message?.includes('No upcoming'))
  })

  it('handles query errors gracefully', async () => {
    const ctx = makeMockCtx({ shouldThrow: true })

    const tools = createReminderTools(ctx as never)
    const result = await execListReminders(tools)

    assert.equal(result.success, false)
    assert.ok(result.error.includes('Network failure'))
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_INVOICE_SETTINGS } from './agentLogic/invoice'
import { DEFAULT_REMINDER_SETTINGS } from './agentLogic/reminder'
import {
  determineExecutionOutcome,
  getUpcomingAppointmentsForReminder,
  reviewPlannedActions,
  sanitizeInvoiceSettings,
  sanitizeReminderSettings,
  selectReminderCandidates,
  updateAppointmentNotes,
  updateLeadNotes,
} from './agentRunner'

describe('sanitizeReminderSettings', () => {
  it('falls back to defaults for invalid input', () => {
    assert.deepEqual(sanitizeReminderSettings(null), DEFAULT_REMINDER_SETTINGS)
    assert.deepEqual(sanitizeReminderSettings('bad'), DEFAULT_REMINDER_SETTINGS)
  })

  it('normalizes windows and batch size', () => {
    const settings = sanitizeReminderSettings({
      reminderWindowHours: [48, 24, 24, -1, 999, '8'],
      maxAppointmentsPerBatch: 12.9,
    })

    assert.deepEqual(settings.reminderWindowHours, [8, 24, 48])
    assert.equal(settings.maxAppointmentsPerBatch, 12)
  })
})

describe('sanitizeInvoiceSettings', () => {
  it('falls back to defaults for invalid input', () => {
    assert.deepEqual(sanitizeInvoiceSettings(null), DEFAULT_INVOICE_SETTINGS)
    assert.deepEqual(sanitizeInvoiceSettings('bad'), DEFAULT_INVOICE_SETTINGS)
  })

  it('normalizes invoice settings into safe bounds', () => {
    const settings = sanitizeInvoiceSettings({
      defaultPaymentTermsDays: 14.9,
      overdueThresholdDays: 5.2,
      maxInvoicesPerBatch: 33.7,
    })

    assert.equal(settings.defaultPaymentTermsDays, 14)
    assert.equal(settings.overdueThresholdDays, 5)
    assert.equal(settings.maxInvoicesPerBatch, 33)
  })
})

describe('updateAppointmentNotes', () => {
  it('skips patch when same-day reminder already exists', async () => {
    const today = new Date().toISOString().split('T')[0]
    const appointment = {
      _id: 'appt_1',
      organizationId: 'org_1',
      notes: `[Reminder ${today}] Existing reminder`,
    }

    let patchCalled = false
    const ctx = {
      db: {
        get: async () => appointment,
        patch: async () => {
          patchCalled = true
        },
      },
    }

    await (updateAppointmentNotes as any)._handler(ctx, {
      organizationId: 'org_1',
      appointmentId: 'appt_1',
      notes: '  New reminder text  ',
    })

    assert.equal(patchCalled, false)
  })

  it('appends reminder marker when none exists', async () => {
    const appointment = {
      _id: 'appt_2',
      organizationId: 'org_1',
      notes: 'Existing notes',
    }

    let patchedNotes = ''
    const ctx = {
      db: {
        get: async () => appointment,
        patch: async (_id: string, updates: { notes: string }) => {
          patchedNotes = updates.notes
        },
      },
    }

    await (updateAppointmentNotes as any)._handler(ctx, {
      organizationId: 'org_1',
      appointmentId: 'appt_2',
      notes: '  Customer prefers SMS reminder  ',
    })

    assert.match(patchedNotes, /\[Reminder \d{4}-\d{2}-\d{2}\] Customer prefers SMS reminder/)
  })
})

describe('updateLeadNotes', () => {
  it('skips patch when same-day reminder marker already exists', async () => {
    const today = new Date().toISOString().split('T')[0]
    const lead = {
      _id: 'lead_1',
      organizationId: 'org_1',
      notes: `[Reminder ${today}] Existing reminder`,
    }

    let patchCalled = false
    const ctx = {
      db: {
        get: async () => lead,
        patch: async () => {
          patchCalled = true
        },
      },
    }

    await (updateLeadNotes as any)._handler(ctx, {
      organizationId: 'org_1',
      leadId: 'lead_1',
      notes: '  Another reminder  ',
      agentType: 'reminder',
    })

    assert.equal(patchCalled, false)
  })

  it('does not update lastContact for analytical sales notes', async () => {
    const lead = {
      _id: 'lead_2',
      organizationId: 'org_1',
      notes: 'Existing notes',
    }

    let patched: { notes: string; lastContact?: number; updatedAt?: number } | null = null
    const ctx = {
      db: {
        get: async () => lead,
        patch: async (
          _id: string,
          updates: { notes: string; lastContact?: number; updatedAt: number }
        ) => {
          patched = updates
        },
      },
    }

    await (updateLeadNotes as any)._handler(ctx, {
      organizationId: 'org_1',
      leadId: 'lead_2',
      notes: '[Sales Score] 7/10 — Good response rate',
      agentType: 'sales',
      touchLastContact: false,
    })

    assert.ok(patched !== null)
    const patchedResult = patched as { notes: string; lastContact?: number; updatedAt?: number }
    assert.equal(patchedResult.lastContact, undefined)
    assert.match(String(patchedResult.notes), /\[Sales \d{4}-\d{2}-\d{2}\] \[Sales Score\] 7\/10/)
  })

  it('updates lastContact by default for contact-style notes', async () => {
    const lead = {
      _id: 'lead_3',
      organizationId: 'org_1',
      notes: '',
    }

    let patched: { notes: string; lastContact?: number; updatedAt?: number } | null = null
    const ctx = {
      db: {
        get: async () => lead,
        patch: async (
          _id: string,
          updates: { notes: string; lastContact?: number; updatedAt: number }
        ) => {
          patched = updates
        },
      },
    }

    await (updateLeadNotes as any)._handler(ctx, {
      organizationId: 'org_1',
      leadId: 'lead_3',
      notes: 'Followed up by phone',
      agentType: 'followup',
    })

    assert.ok(patched !== null)
    const patchedResult = patched as { notes: string; lastContact?: number; updatedAt?: number }
    assert.equal(typeof patchedResult.lastContact, 'number')
  })
})

describe('reviewPlannedActions', () => {
  it('separates policy rejections from approval-required rejections', () => {
    const reviewed = reviewPlannedActions(
      [
        {
          type: 'update_appointment_notes',
          target: 'appt_1',
          params: { notes: 'valid' },
          riskLevel: 'low',
          reasoning: 'valid reminder',
        },
        {
          type: 'update_appointment_notes',
          target: 'appt_1',
          params: { notes: 'duplicate' },
          riskLevel: 'low',
          reasoning: 'duplicate reminder',
        },
        {
          type: 'unknown_action',
          target: 'lead_1',
          params: {},
          riskLevel: 'low',
          reasoning: 'disallowed',
        },
        {
          type: 'custom_high_action',
          target: 'lead_2',
          params: {},
          riskLevel: 'high',
          reasoning: 'should require approval',
        },
      ],
      {
        allowedActions: ['update_appointment_notes', 'custom_high_action'],
        maxActionsPerRun: 10,
        riskOverrides: {},
        requireApprovalAbove: 'high',
      },
      'reminder'
    )

    assert.equal(reviewed.approved.length, 1)
    assert.equal(reviewed.rejectedByPolicy.length, 2)
    assert.equal(reviewed.rejectedForApproval.length, 1)
    assert.equal(reviewed.rejectedForApproval[0].type, 'custom_high_action')
  })
})

describe('determineExecutionOutcome', () => {
  it('fails the run when any action execution fails', () => {
    const outcome = determineExecutionOutcome({
      failureCount: 1,
      rejectedForApprovalCount: 2,
    })

    assert.equal(outcome.status, 'failed')
    assert.match(String(outcome.error), /1 action\(s\) failed/)
  })

  it('awaits approval when no failures but approval is required', () => {
    const outcome = determineExecutionOutcome({
      failureCount: 0,
      rejectedForApprovalCount: 1,
    })

    assert.equal(outcome.status, 'awaiting_approval')
    assert.equal(outcome.error, undefined)
  })

  it('completes when there are no failures or approval blocks', () => {
    const outcome = determineExecutionOutcome({
      failureCount: 0,
      rejectedForApprovalCount: 0,
    })

    assert.equal(outcome.status, 'completed')
    assert.equal(outcome.error, undefined)
  })
})

describe('selectReminderCandidates', () => {
  it('uses UTC timestamps for boundary filtering', () => {
    const now = Date.parse('2026-03-10T00:30:00Z')
    const windowEnd = Date.parse('2026-03-10T03:00:00Z')

    const selected = selectReminderCandidates(
      [
        {
          _id: 'appt_past',
          leadId: 'lead_1',
          leadName: 'Past lead',
          date: '2026-03-10',
          time: '00:00',
          status: 'scheduled',
        },
        {
          _id: 'appt_future',
          leadId: 'lead_2',
          leadName: 'Future lead',
          date: '2026-03-10',
          time: '01:00',
          status: 'scheduled',
        },
      ],
      now,
      windowEnd
    )

    assert.equal(selected.length, 1)
    assert.equal(selected[0].id, 'appt_future')
    assert.equal(selected[0].hoursUntil, 1)
  })
})

describe('getUpcomingAppointmentsForReminder', () => {
  it('paginates through all pages so later valid appointments are not missed', async () => {
    const firstPage = {
      page: [
        {
          _id: 'appt_invalid',
          leadId: 'lead_1',
          leadName: 'Invalid',
          date: '2026-03-10',
          time: '00:00',
          status: 'cancelled',
        },
      ],
      isDone: false,
      continueCursor: 'cursor_1',
    }

    const secondPage = {
      page: [
        {
          _id: 'appt_valid',
          leadId: 'lead_2',
          leadName: 'Valid',
          date: '2026-03-10',
          time: '01:00',
          status: 'scheduled',
          notes: '',
        },
      ],
      isDone: true,
      continueCursor: 'cursor_2',
    }

    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            order: () => ({
              paginate: async ({ cursor }: { cursor: string | null }) =>
                cursor ? secondPage : firstPage,
            }),
          }),
        }),
      },
    }

    const results = await (getUpcomingAppointmentsForReminder as any)._handler(ctx, {
      organizationId: 'org_1',
      windowHours: 24,
      maxAppointments: 10,
      now: Date.parse('2026-03-10T00:30:00Z'),
    })

    assert.equal(results.length, 1)
    assert.equal(results[0].id, 'appt_valid')
  })
})

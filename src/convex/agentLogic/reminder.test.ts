import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateReminderPlan } from './reminder'

describe('validateReminderPlan', () => {
  it('parses a well-formed reminder plan', () => {
    const plan = validateReminderPlan({
      actions: [
        {
          type: 'update_appointment_notes',
          target: 'appt_123',
          params: { notes: 'Reminder: appointment tomorrow at 10:00' },
          riskLevel: 'low',
          reasoning: 'Appointment is within 24 hours',
        },
      ],
      summary: 'One reminder action',
      reasoning: 'Upcoming appointment requires reminder',
    })

    assert.equal(plan.actions.length, 1)
    assert.equal(plan.actions[0].type, 'update_appointment_notes')
    assert.equal(plan.actions[0].target, 'appt_123')
    assert.equal(plan.actions[0].riskLevel, 'low')
  })

  it('defaults invalid risk levels to low', () => {
    const plan = validateReminderPlan({
      actions: [
        {
          type: 'log_reminder_recommendation',
          target: 'lead_1',
          params: {},
          riskLevel: 'critical',
          reasoning: 'test',
        },
      ],
    })

    assert.equal(plan.actions[0].riskLevel, 'low')
  })

  it('throws on missing actions array', () => {
    assert.throws(() => validateReminderPlan({ summary: 'missing actions' }), /missing or invalid/)
  })
})

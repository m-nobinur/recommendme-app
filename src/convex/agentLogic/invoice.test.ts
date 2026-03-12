import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildInvoiceUserPromptFromData, validateInvoicePlan } from './invoice'

describe('buildInvoiceUserPromptFromData', () => {
  it('includes appointment, invoice, and settings context', () => {
    const prompt = buildInvoiceUserPromptFromData(
      [
        {
          id: 'appt_1',
          leadId: 'lead_1',
          leadName: 'Sarah',
          date: '2026-03-10',
          time: '10:00',
          title: 'Portrait Session',
          status: 'completed',
        },
      ],
      [
        {
          id: 'inv_1',
          leadName: 'Alex',
          amount: 250,
          status: 'sent',
          dueDate: '2026-03-01',
          daysSinceDue: 9,
          createdAt: Date.now(),
        },
      ],
      [
        {
          id: 'lead_1',
          name: 'Sarah',
          email: 'sarah@example.com',
        },
      ],
      [],
      [],
      {
        defaultPaymentTermsDays: 21,
      }
    )

    assert.match(prompt, /Default payment terms: Net 21 days/)
    assert.match(prompt, /Completed Appointments Without Invoices/)
    assert.match(prompt, /Overdue Invoices/)
  })
})

describe('validateInvoicePlan', () => {
  it('accepts valid plans and normalizes invalid risk levels to medium', () => {
    const plan = validateInvoicePlan({
      actions: [
        {
          type: 'create_invoice',
          target: 'lead_1',
          params: { amount: 500, description: 'Session' },
          riskLevel: 'unexpected',
          reasoning: 'needs invoice',
        },
      ],
      summary: 'Created invoice',
      reasoning: 'Completed appointment needs billing',
    })

    assert.equal(plan.actions.length, 1)
    assert.equal(plan.actions[0].riskLevel, 'medium')
  })

  it('throws for unsupported action types', () => {
    assert.throws(
      () =>
        validateInvoicePlan({
          actions: [
            {
              type: 'delete_invoice',
              target: 'inv_1',
              params: {},
              riskLevel: 'low',
              reasoning: 'invalid',
            },
          ],
        }),
      /Invalid action type/
    )
  })
})

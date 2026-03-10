import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sanitizeSalesSettings } from '../agentRunner'
import { buildSalesUserPromptFromData, DEFAULT_SALES_SETTINGS, validateSalesPlan } from './sales'

// ---------------------------------------------------------------------------
// buildSalesUserPromptFromData
// ---------------------------------------------------------------------------

describe('buildSalesUserPromptFromData', () => {
  const baseLead = {
    id: 'lead_1',
    name: 'Sarah',
    status: 'Qualified',
    tags: ['vip'],
    daysSinceUpdate: 3,
    appointmentCount: 2,
    completedAppointmentCount: 1,
    invoiceCount: 1,
    paidInvoiceCount: 0,
    totalInvoiceAmount: 500,
  }

  it('includes pipeline summary with settings', () => {
    const prompt = buildSalesUserPromptFromData(
      [baseLead],
      { total: 1, byStatus: { Qualified: 1 }, totalValue: 500, staleCount: 0 },
      [],
      []
    )

    assert.match(prompt, /Stale threshold: 7 days/)
    assert.match(prompt, /High value threshold: \$1000/)
    assert.match(prompt, /Total leads: 1/)
  })

  it('marks stale leads with warning', () => {
    const staleLead = { ...baseLead, daysSinceUpdate: 14 }
    const prompt = buildSalesUserPromptFromData(
      [staleLead],
      { total: 1, byStatus: { Qualified: 1 }, totalValue: 500, staleCount: 1 },
      [],
      []
    )

    assert.match(prompt, /STALE/)
  })

  it('uses custom settings when provided', () => {
    const prompt = buildSalesUserPromptFromData(
      [baseLead],
      { total: 1, byStatus: { Qualified: 1 }, totalValue: 500, staleCount: 0 },
      [],
      [],
      { staleThresholdDays: 14, highValueThreshold: 5000 }
    )

    assert.match(prompt, /Stale threshold: 14 days/)
    assert.match(prompt, /High value threshold: \$5000/)
  })

  it('includes agent memories when present', () => {
    const prompt = buildSalesUserPromptFromData(
      [baseLead],
      { total: 1, byStatus: {}, totalValue: 500, staleCount: 0 },
      [{ category: 'pattern', content: 'Clients prefer morning calls', confidence: 0.85 }],
      []
    )

    assert.match(prompt, /Past Learnings/)
    assert.match(prompt, /morning calls/)
  })

  it('includes business context when present', () => {
    const prompt = buildSalesUserPromptFromData(
      [baseLead],
      { total: 1, byStatus: {}, totalValue: 500, staleCount: 0 },
      [],
      [{ type: 'pricing', content: 'Standard rate is $200/hr', confidence: 0.9 }]
    )

    assert.match(prompt, /Business Context/)
    assert.match(prompt, /Standard rate/)
  })

  it('handles empty leads list', () => {
    const prompt = buildSalesUserPromptFromData(
      [],
      { total: 0, byStatus: {}, totalValue: 0, staleCount: 0 },
      [],
      []
    )

    assert.match(prompt, /No leads found to analyze/)
  })

  it('orders stages correctly in summary', () => {
    const prompt = buildSalesUserPromptFromData(
      [],
      {
        total: 3,
        byStatus: { Booked: 1, New: 1, Qualified: 1 },
        totalValue: 0,
        staleCount: 0,
      },
      [],
      []
    )

    const newIdx = prompt.indexOf('New: 1')
    const qualIdx = prompt.indexOf('Qualified: 1')
    const bookedIdx = prompt.indexOf('Booked: 1')
    assert.ok(newIdx < qualIdx, 'New before Qualified')
    assert.ok(qualIdx < bookedIdx, 'Qualified before Booked')
  })

  it('truncates long notes to 200 chars', () => {
    const longNotesLead = { ...baseLead, notes: 'x'.repeat(300) }
    const prompt = buildSalesUserPromptFromData(
      [longNotesLead],
      { total: 1, byStatus: {}, totalValue: 500, staleCount: 0 },
      [],
      []
    )

    assert.ok(!prompt.includes('x'.repeat(300)), 'notes are truncated')
    assert.ok(prompt.includes('x'.repeat(200)), 'notes show first 200 chars')
  })
})

// ---------------------------------------------------------------------------
// validateSalesPlan
// ---------------------------------------------------------------------------

describe('validateSalesPlan', () => {
  it('accepts valid plan with all action types', () => {
    const plan = validateSalesPlan({
      actions: [
        {
          type: 'score_lead',
          target: 'lead_1',
          params: { score: 7 },
          riskLevel: 'low',
          reasoning: 'Active lead',
        },
        {
          type: 'recommend_stage_change',
          target: 'lead_2',
          params: {},
          riskLevel: 'low',
          reasoning: 'Ready for proposal',
        },
        {
          type: 'flag_stale_lead',
          target: 'lead_3',
          params: {},
          riskLevel: 'low',
          reasoning: '14 days inactive',
        },
        {
          type: 'log_pipeline_insight',
          target: '',
          params: {},
          riskLevel: 'low',
          reasoning: 'Pipeline healthy',
        },
      ],
      summary: 'Scored 4 leads',
      reasoning: 'Regular pipeline review',
    })

    assert.equal(plan.actions.length, 4)
    assert.equal(plan.summary, 'Scored 4 leads')
    assert.equal(plan.reasoning, 'Regular pipeline review')
  })

  it('normalizes invalid risk levels to low', () => {
    const plan = validateSalesPlan({
      actions: [
        {
          type: 'score_lead',
          target: 'lead_1',
          params: {},
          riskLevel: 'critical',
          reasoning: 'test',
        },
      ],
      summary: '',
      reasoning: '',
    })

    assert.equal(plan.actions[0].riskLevel, 'low')
  })

  it('normalizes legacy stage-change params to canonical fields', () => {
    const plan = validateSalesPlan({
      actions: [
        {
          type: 'recommend_stage_change',
          target: 'lead_1',
          params: { toStage: 'Proposal', currentStage: 'Qualified' },
          riskLevel: 'low',
          reasoning: 'legacy format',
        },
      ],
    })

    assert.equal(plan.actions[0].params.recommendedStage, 'Proposal')
    assert.equal(plan.actions[0].params.currentStage, 'Qualified')
  })

  it('normalizes legacy stale params to canonical fields', () => {
    const plan = validateSalesPlan({
      actions: [
        {
          type: 'flag_stale_lead',
          target: 'lead_1',
          params: { daysSinceContact: 12, suggestion: 'Send follow-up' },
          riskLevel: 'low',
          reasoning: 'legacy format',
        },
      ],
    })

    assert.equal(plan.actions[0].params.daysSinceUpdate, 12)
    assert.equal(plan.actions[0].params.notes, 'Send follow-up')
  })

  it('throws for unsupported action types', () => {
    assert.throws(
      () =>
        validateSalesPlan({
          actions: [
            {
              type: 'delete_lead',
              target: 'lead_1',
              params: {},
              riskLevel: 'low',
              reasoning: 'invalid',
            },
          ],
        }),
      /Invalid action type/
    )
  })

  it('throws for non-object input', () => {
    assert.throws(() => validateSalesPlan(null), /expected an object/)
    assert.throws(() => validateSalesPlan('string'), /expected an object/)
  })

  it('throws for missing actions array', () => {
    assert.throws(() => validateSalesPlan({ summary: 'no actions' }), /missing or invalid/)
  })

  it('throws for non-object action entries', () => {
    assert.throws(() => validateSalesPlan({ actions: ['not an object'] }), /expected an object/)
  })

  it('defaults missing optional fields', () => {
    const plan = validateSalesPlan({
      actions: [{ type: 'score_lead' }],
    })

    assert.equal(plan.actions[0].target, '')
    assert.equal(plan.actions[0].reasoning, '')
    assert.equal(plan.summary, '')
    assert.equal(plan.reasoning, '')
  })
})

// ---------------------------------------------------------------------------
// DEFAULT_SALES_SETTINGS
// ---------------------------------------------------------------------------

describe('DEFAULT_SALES_SETTINGS', () => {
  it('has sensible defaults', () => {
    assert.equal(DEFAULT_SALES_SETTINGS.staleThresholdDays, 7)
    assert.equal(DEFAULT_SALES_SETTINGS.maxLeadsPerBatch, 50)
    assert.equal(DEFAULT_SALES_SETTINGS.highValueThreshold, 1000)
  })
})

// ---------------------------------------------------------------------------
// sanitizeSalesSettings
// ---------------------------------------------------------------------------

describe('sanitizeSalesSettings', () => {
  it('returns defaults for null/undefined/non-object input', () => {
    assert.deepStrictEqual(sanitizeSalesSettings(null), DEFAULT_SALES_SETTINGS)
    assert.deepStrictEqual(sanitizeSalesSettings(undefined), DEFAULT_SALES_SETTINGS)
    assert.deepStrictEqual(sanitizeSalesSettings('string'), DEFAULT_SALES_SETTINGS)
  })

  it('accepts valid settings', () => {
    const result = sanitizeSalesSettings({
      staleThresholdDays: 14,
      maxLeadsPerBatch: 100,
      highValueThreshold: 5000,
    })
    assert.equal(result.staleThresholdDays, 14)
    assert.equal(result.maxLeadsPerBatch, 100)
    assert.equal(result.highValueThreshold, 5000)
  })

  it('clamps below-minimum values to defaults', () => {
    const result = sanitizeSalesSettings({
      staleThresholdDays: 0,
      maxLeadsPerBatch: 0,
      highValueThreshold: -1,
    })
    assert.equal(result.staleThresholdDays, DEFAULT_SALES_SETTINGS.staleThresholdDays)
    assert.equal(result.maxLeadsPerBatch, DEFAULT_SALES_SETTINGS.maxLeadsPerBatch)
    assert.equal(result.highValueThreshold, DEFAULT_SALES_SETTINGS.highValueThreshold)
  })

  it('clamps above-maximum values to defaults', () => {
    const result = sanitizeSalesSettings({
      staleThresholdDays: 999,
      maxLeadsPerBatch: 999,
      highValueThreshold: 999_999_999,
    })
    assert.equal(result.staleThresholdDays, DEFAULT_SALES_SETTINGS.staleThresholdDays)
    assert.equal(result.maxLeadsPerBatch, DEFAULT_SALES_SETTINGS.maxLeadsPerBatch)
    assert.equal(result.highValueThreshold, DEFAULT_SALES_SETTINGS.highValueThreshold)
  })

  it('floors fractional batch sizes', () => {
    const result = sanitizeSalesSettings({
      staleThresholdDays: 10.7,
      maxLeadsPerBatch: 25.9,
      highValueThreshold: 2000.5,
    })
    assert.equal(result.staleThresholdDays, 10)
    assert.equal(result.maxLeadsPerBatch, 25)
    assert.equal(result.highValueThreshold, 2000.5)
  })

  it('rejects NaN and Infinity', () => {
    const result = sanitizeSalesSettings({
      staleThresholdDays: Number.NaN,
      maxLeadsPerBatch: Number.POSITIVE_INFINITY,
      highValueThreshold: Number.NaN,
    })
    assert.deepStrictEqual(result, DEFAULT_SALES_SETTINGS)
  })
})

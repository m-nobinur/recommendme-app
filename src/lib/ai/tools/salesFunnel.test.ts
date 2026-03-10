import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeEngagementScore, createSalesFunnelTools } from './salesFunnel'

// ---------------------------------------------------------------------------
// computeEngagementScore
// ---------------------------------------------------------------------------

describe('computeEngagementScore', () => {
  it('gives baseline score of 5 for a New lead with no activity', () => {
    const { score } = computeEngagementScore({
      status: 'New',
      daysSinceContact: 3,
      appointmentCount: 0,
      invoiceTotal: 0,
    })
    assert.ok(score >= 5 && score <= 6, `expected 5-6, got ${score}`)
  })

  it('adds stage bonus for advanced stages', () => {
    const newScore = computeEngagementScore({
      status: 'New',
      daysSinceContact: 3,
      appointmentCount: 0,
      invoiceTotal: 0,
    })
    const bookedScore = computeEngagementScore({
      status: 'Booked',
      daysSinceContact: 3,
      appointmentCount: 0,
      invoiceTotal: 0,
    })
    assert.ok(bookedScore.score > newScore.score, 'Booked scores higher than New')
  })

  it('adds appointment bonus capped at 3', () => {
    const oneAppt = computeEngagementScore({
      status: 'New',
      daysSinceContact: 3,
      appointmentCount: 1,
      invoiceTotal: 0,
    })
    const fiveAppts = computeEngagementScore({
      status: 'New',
      daysSinceContact: 3,
      appointmentCount: 5,
      invoiceTotal: 0,
    })
    assert.ok(fiveAppts.score === oneAppt.score + 2, 'appointment bonus caps at 3')
  })

  it('adds invoice bonus', () => {
    const noInvoice = computeEngagementScore({
      status: 'New',
      daysSinceContact: 3,
      appointmentCount: 0,
      invoiceTotal: 0,
    })
    const withInvoice = computeEngagementScore({
      status: 'New',
      daysSinceContact: 3,
      appointmentCount: 0,
      invoiceTotal: 500,
    })
    assert.ok(withInvoice.score > noInvoice.score, 'invoiced lead scores higher')
  })

  it('adds high-value bonus for value > 1000', () => {
    const lowValue = computeEngagementScore({
      status: 'New',
      value: 500,
      daysSinceContact: 3,
      appointmentCount: 0,
      invoiceTotal: 0,
    })
    const highValue = computeEngagementScore({
      status: 'New',
      value: 2000,
      daysSinceContact: 3,
      appointmentCount: 0,
      invoiceTotal: 0,
    })
    assert.ok(highValue.score > lowValue.score, 'high value lead scores higher')
  })

  it('applies stale penalty for inactive leads', () => {
    const active = computeEngagementScore({
      status: 'Qualified',
      daysSinceContact: 2,
      appointmentCount: 0,
      invoiceTotal: 0,
    })
    const stale = computeEngagementScore({
      status: 'Qualified',
      daysSinceContact: 21,
      appointmentCount: 0,
      invoiceTotal: 0,
    })
    assert.ok(stale.score < active.score, 'stale lead scores lower')
  })

  it('adds recency bonus for very recent contacts', () => {
    const recent = computeEngagementScore({
      status: 'New',
      daysSinceContact: 1,
      appointmentCount: 0,
      invoiceTotal: 0,
    })
    const notRecent = computeEngagementScore({
      status: 'New',
      daysSinceContact: 5,
      appointmentCount: 0,
      invoiceTotal: 0,
    })
    assert.ok(recent.score > notRecent.score, 'recently active scores higher')
  })

  it('clamps score to minimum 1', () => {
    const { score } = computeEngagementScore({
      status: 'New',
      daysSinceContact: 365,
      appointmentCount: 0,
      invoiceTotal: 0,
    })
    assert.ok(score >= 1, `score should be at least 1, got ${score}`)
  })

  it('clamps score to maximum 10', () => {
    const { score } = computeEngagementScore({
      status: 'Booked',
      value: 5000,
      daysSinceContact: 0,
      appointmentCount: 10,
      invoiceTotal: 10000,
    })
    assert.ok(score <= 10, `score should be at most 10, got ${score}`)
  })

  it('returns reasoning with factors', () => {
    const { reasoning } = computeEngagementScore({
      status: 'Qualified',
      daysSinceContact: 1,
      appointmentCount: 2,
      invoiceTotal: 500,
    })
    assert.ok(reasoning.includes('Qualified'), 'mentions stage')
    assert.ok(reasoning.includes('appointment'), 'mentions appointments')
    assert.ok(reasoning.includes('invoiced'), 'mentions invoices')
  })

  it('returns baseline reasoning for no-bonus leads', () => {
    const { reasoning } = computeEngagementScore({
      status: 'New',
      daysSinceContact: 5,
      appointmentCount: 0,
      invoiceTotal: 0,
    })
    assert.equal(reasoning, 'Baseline score')
  })
})

// ---------------------------------------------------------------------------
// createSalesFunnelTools
// ---------------------------------------------------------------------------

function makeMockCtx(overrides: {
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
        return {}
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

async function execGetLeadScore(
  tools: ReturnType<typeof createSalesFunnelTools>,
  args: { leadName: string }
): Promise<AnyResult> {
  const exec = tools.getLeadScore.execute
  if (!exec) throw new Error('getLeadScore.execute is undefined')
  return exec(args, { toolCallId: 'tc_1', messages: [], abortSignal: undefined as never })
}

async function execGetPipelineOverview(
  tools: ReturnType<typeof createSalesFunnelTools>
): Promise<AnyResult> {
  const exec = tools.getPipelineOverview.execute
  if (!exec) throw new Error('getPipelineOverview.execute is undefined')
  return exec({}, { toolCallId: 'tc_1', messages: [], abortSignal: undefined as never })
}

async function execGetLeadRecommendation(
  tools: ReturnType<typeof createSalesFunnelTools>,
  args: { leadName: string }
): Promise<AnyResult> {
  const exec = tools.getLeadRecommendation.execute
  if (!exec) throw new Error('getLeadRecommendation.execute is undefined')
  return exec(args, { toolCallId: 'tc_1', messages: [], abortSignal: undefined as never })
}

describe('createSalesFunnelTools', () => {
  it('returns all three sales tools', () => {
    const tools = createSalesFunnelTools(makeMockCtx({}) as never)
    assert.ok(tools.getLeadScore, 'getLeadScore tool exists')
    assert.ok(tools.getPipelineOverview, 'getPipelineOverview tool exists')
    assert.ok(tools.getLeadRecommendation, 'getLeadRecommendation tool exists')
  })
})

describe('getLeadScore execute', () => {
  it('returns error when lead not found', async () => {
    const tools = createSalesFunnelTools(makeMockCtx({ queryResult: [] }) as never)
    const result = await execGetLeadScore(tools, { leadName: 'Unknown' })

    assert.equal(result.success, false)
    assert.ok(result.error.includes('not found'))
  })

  it('handles network errors gracefully', async () => {
    const tools = createSalesFunnelTools(makeMockCtx({ shouldThrow: true }) as never)
    const result = await execGetLeadScore(tools, { leadName: 'Anyone' })

    assert.equal(result.success, false)
    assert.ok(result.error.includes('Network failure'))
  })

  it('returns disambiguation error when multiple leads match', async () => {
    const tools = createSalesFunnelTools(
      makeMockCtx({
        queryResult: [
          {
            _id: 'lead_1',
            name: 'John Doe',
            status: 'New',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          {
            _id: 'lead_2',
            name: 'Johnny Cash',
            status: 'Qualified',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      }) as never
    )
    const result = await execGetLeadScore(tools, { leadName: 'john' })

    assert.equal(result.success, false)
    assert.ok(result.error.includes('Multiple leads matched'))
  })
})

describe('getPipelineOverview execute', () => {
  it('handles network errors gracefully', async () => {
    const tools = createSalesFunnelTools(makeMockCtx({ shouldThrow: true }) as never)
    const result = await execGetPipelineOverview(tools)

    assert.equal(result.success, false)
    assert.ok(result.error.includes('Network failure'))
  })
})

describe('getLeadRecommendation execute', () => {
  it('returns error when lead not found', async () => {
    const tools = createSalesFunnelTools(makeMockCtx({ queryResult: [] }) as never)
    const result = await execGetLeadRecommendation(tools, { leadName: 'Ghost' })

    assert.equal(result.success, false)
    assert.ok(result.error.includes('not found'))
  })

  it('handles network errors gracefully', async () => {
    const tools = createSalesFunnelTools(makeMockCtx({ shouldThrow: true }) as never)
    const result = await execGetLeadRecommendation(tools, { leadName: 'Anyone' })

    assert.equal(result.success, false)
    assert.ok(result.error.includes('Network failure'))
  })

  it('returns disambiguation error when multiple leads match', async () => {
    const tools = createSalesFunnelTools(
      makeMockCtx({
        queryResult: [
          {
            _id: 'lead_1',
            name: 'Acme Corp',
            status: 'Contacted',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          {
            _id: 'lead_2',
            name: 'Acme Holdings',
            status: 'Qualified',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      }) as never
    )
    const result = await execGetLeadRecommendation(tools, { leadName: 'acme' })

    assert.equal(result.success, false)
    assert.ok(result.error.includes('Multiple leads matched'))
  })
})

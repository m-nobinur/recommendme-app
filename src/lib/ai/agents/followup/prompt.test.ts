import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AgentContext } from '../core/types'
import { buildFollowupUserPrompt, FOLLOWUP_SYSTEM_PROMPT } from './prompt'

function makeContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    organizationId: 'org_test_123',
    userId: 'user_test_123',
    agentType: 'followup',
    leads: [],
    appointments: [],
    agentMemories: [],
    businessContext: [],
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('FOLLOWUP_SYSTEM_PROMPT', () => {
  it('contains the output format specification', () => {
    assert.ok(FOLLOWUP_SYSTEM_PROMPT.includes('"actions"'))
    assert.ok(FOLLOWUP_SYSTEM_PROMPT.includes('"type"'))
    assert.ok(FOLLOWUP_SYSTEM_PROMPT.includes('"target"'))
  })

  it('specifies the three allowed action types', () => {
    assert.ok(FOLLOWUP_SYSTEM_PROMPT.includes('update_lead_notes'))
    assert.ok(FOLLOWUP_SYSTEM_PROMPT.includes('update_lead_status'))
    assert.ok(FOLLOWUP_SYSTEM_PROMPT.includes('log_recommendation'))
  })

  it('instructs not to advance leads backward', () => {
    assert.ok(FOLLOWUP_SYSTEM_PROMPT.includes('never backward'))
  })
})

describe('buildFollowupUserPrompt', () => {
  it('includes the stale leads count header', () => {
    const prompt = buildFollowupUserPrompt(
      makeContext({
        leads: [
          {
            id: 'lead_1',
            name: 'Sarah Johnson',
            status: 'Contacted',
            tags: ['wedding'],
            daysSinceContact: 5,
            value: 2500,
          },
          {
            id: 'lead_2',
            name: 'Mike Chen',
            status: 'Qualified',
            tags: ['corporate'],
            daysSinceContact: 10,
          },
        ],
      })
    )
    assert.ok(prompt.includes('## Stale Leads (2)'))
  })

  it('renders lead details correctly', () => {
    const prompt = buildFollowupUserPrompt(
      makeContext({
        leads: [
          {
            id: 'lead_abc',
            name: 'Sarah Johnson',
            status: 'Contacted',
            email: 'sarah@example.com',
            phone: '555-0123',
            value: 3000,
            tags: ['wedding', 'premium'],
            notes: 'Interested in outdoor ceremony',
            daysSinceContact: 7,
          },
        ],
      })
    )
    assert.ok(prompt.includes('ID: lead_abc'))
    assert.ok(prompt.includes('Name: Sarah Johnson'))
    assert.ok(prompt.includes('Status: Contacted'))
    assert.ok(prompt.includes('Days since contact: 7'))
    assert.ok(prompt.includes('Value: $3000'))
    assert.ok(prompt.includes('Email: sarah@example.com'))
    assert.ok(prompt.includes('Phone: 555-0123'))
    assert.ok(prompt.includes('Tags: wedding, premium'))
    assert.ok(prompt.includes('Notes: Interested in outdoor ceremony'))
  })

  it('truncates long notes to 200 chars', () => {
    const longNote = 'A'.repeat(300)
    const prompt = buildFollowupUserPrompt(
      makeContext({
        leads: [
          {
            id: 'lead_1',
            name: 'Test',
            status: 'Contacted',
            tags: [],
            notes: longNote,
            daysSinceContact: 5,
          },
        ],
      })
    )
    assert.ok(!prompt.includes(longNote))
    assert.ok(prompt.includes('A'.repeat(200)))
  })

  it('includes appointments section when present', () => {
    const prompt = buildFollowupUserPrompt(
      makeContext({
        leads: [{ id: 'l1', name: 'Test', status: 'Contacted', tags: [], daysSinceContact: 3 }],
        appointments: [
          {
            id: 'apt_1',
            leadName: 'Sarah Johnson',
            date: '2026-03-01',
            time: '14:00',
            status: 'scheduled',
          },
        ],
      })
    )
    assert.ok(prompt.includes('## Recent Appointments'))
    assert.ok(prompt.includes('Sarah Johnson: 2026-03-01 14:00 (scheduled)'))
  })

  it('omits appointments section when empty', () => {
    const prompt = buildFollowupUserPrompt(
      makeContext({
        leads: [{ id: 'l1', name: 'Test', status: 'Contacted', tags: [], daysSinceContact: 3 }],
      })
    )
    assert.ok(!prompt.includes('Recent Appointments'))
  })

  it('includes past learnings section when agent memories exist', () => {
    const prompt = buildFollowupUserPrompt(
      makeContext({
        leads: [{ id: 'l1', name: 'Test', status: 'Contacted', tags: [], daysSinceContact: 3 }],
        agentMemories: [
          {
            id: 'mem_1',
            category: 'success',
            content: 'Following up within 3 days gets 80% response rate',
            confidence: 0.85,
            successRate: 0.8,
            useCount: 5,
          },
        ],
      })
    )
    assert.ok(prompt.includes('## Past Learnings'))
    assert.ok(prompt.includes('[success]'))
    assert.ok(prompt.includes('Following up within 3 days'))
    assert.ok(prompt.includes('confidence: 0.85'))
  })

  it('includes business context section when present', () => {
    const prompt = buildFollowupUserPrompt(
      makeContext({
        leads: [{ id: 'l1', name: 'Test', status: 'Contacted', tags: [], daysSinceContact: 3 }],
        businessContext: [
          '[preference] Business hours are 9am-5pm',
          '[fact] Owner specializes in wedding photography',
        ],
      })
    )
    assert.ok(prompt.includes('## Business Context'))
    assert.ok(prompt.includes('Business hours are 9am-5pm'))
    assert.ok(prompt.includes('wedding photography'))
  })

  it('ends with the analysis instruction', () => {
    const prompt = buildFollowupUserPrompt(
      makeContext({
        leads: [{ id: 'l1', name: 'Test', status: 'Contacted', tags: [], daysSinceContact: 3 }],
      })
    )
    assert.ok(prompt.includes('Analyze these leads and generate a follow-up plan'))
  })
})

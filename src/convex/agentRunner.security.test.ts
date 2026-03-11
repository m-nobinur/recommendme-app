import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { recordAgentLearning } from './agentRunner'

function createQueryResult(recent: Array<Record<string, unknown>>) {
  return {
    withIndex: () => ({
      order: () => ({
        take: async () => recent,
      }),
    }),
  }
}

describe('agentRunner.recordAgentLearning', () => {
  it('redacts PII when creating a new agent memory', async () => {
    const inserts: Array<Record<string, unknown>> = []
    const ctx = {
      db: {
        query: () => createQueryResult([]),
        patch: async () => null,
        insert: async (_table: string, doc: Record<string, unknown>) => {
          inserts.push(doc)
          return 'new_memory_1'
        },
      },
    }

    const id = await (recordAgentLearning as any)._handler(ctx, {
      organizationId: 'org_1',
      agentType: 'chat',
      category: 'pattern',
      content: 'Send summary to owner@example.com after each run.',
      confidence: 0.8,
    })

    assert.equal(id, 'new_memory_1')
    assert.equal(inserts.length, 1)
    assert.equal((inserts[0].content as string).includes('[REDACTED_EMAIL]'), true)
  })

  it('redacts PII when updating an existing duplicate memory', async () => {
    const patches: Array<Record<string, unknown>> = []
    const now = Date.now()
    const ctx = {
      db: {
        query: () =>
          createQueryResult([
            {
              _id: 'existing_1',
              category: 'pattern',
              createdAt: now,
              confidence: 0.7,
              useCount: 2,
            },
          ]),
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, ...patch })
          return null
        },
        insert: async () => 'should_not_insert',
      },
    }

    const id = await (recordAgentLearning as any)._handler(ctx, {
      organizationId: 'org_1',
      agentType: 'chat',
      category: 'pattern',
      content: 'Escalate issues to security@example.com immediately.',
      confidence: 0.85,
    })

    assert.equal(id, 'existing_1')
    assert.equal(patches.length, 1)
    assert.equal((patches[0].content as string).includes('[REDACTED_EMAIL]'), true)
  })
})

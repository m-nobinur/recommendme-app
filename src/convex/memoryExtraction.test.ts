import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { insertAgentMemory } from './memoryExtraction'

describe('memoryExtraction.insertAgentMemory', () => {
  it('redacts agent-layer PII before insert', async () => {
    const inserted: Array<Record<string, unknown>> = []
    const ctx = {
      db: {
        insert: async (_table: string, doc: Record<string, unknown>) => {
          inserted.push(doc)
          return 'agent_mem_1'
        },
      },
    }

    const result = await (insertAgentMemory as any)._handler(ctx, {
      organizationId: 'org_1',
      agentType: 'chat',
      category: 'pattern',
      content: 'Follow up with jane@example.com tomorrow morning.',
      confidence: 0.9,
    })

    assert.equal(result.id, 'agent_mem_1')
    assert.equal(result.content.includes('[REDACTED_EMAIL]'), true)
    assert.equal(inserted.length, 1)
    assert.equal((inserted[0].content as string).includes('[REDACTED_EMAIL]'), true)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { recordFeedbackFromApi } from './feedback'

describe('feedback.recordFeedbackFromApi', () => {
  it('inserts a feedback memory event with conversation-scoped idempotency key', async () => {
    const originalToken = process.env.MEMORY_API_TOKEN
    const originalDisable = process.env.DISABLE_AUTH_IN_DEV

    delete process.env.MEMORY_API_TOKEN
    process.env.DISABLE_AUTH_IN_DEV = 'true'

    const inserts: Array<{ table: string; doc: Record<string, unknown> }> = []

    try {
      const ctx = {
        db: {
          query: () => ({
            withIndex: (indexName: string, _builder: unknown) => {
              if (indexName === 'by_org_conversation_message') {
                return {
                  first: async () => ({
                    userId: 'user_1',
                    role: 'assistant',
                  }),
                }
              }
              return {
                first: async () => null,
              }
            },
          }),
          insert: async (table: string, doc: Record<string, unknown>) => {
            inserts.push({ table, doc })
            return 'event_1'
          },
        },
      }

      const result = await (recordFeedbackFromApi as any)._handler(ctx, {
        organizationId: 'org_1',
        messageId: 'msg_1',
        conversationId: 'conv_1',
        rating: 'up',
        comment: 'Great response',
      })

      assert.equal(result.success, true)
      assert.equal(result.eventId, 'event_1')
      assert.equal(inserts.length, 1)
      assert.equal(inserts[0]?.table, 'memoryEvents')
      assert.equal(inserts[0]?.doc.idempotencyKey, 'feedback:conv_1:msg_1')
      assert.equal(inserts[0]?.doc.sourceId, 'msg_1')
    } finally {
      process.env.MEMORY_API_TOKEN = originalToken
      process.env.DISABLE_AUTH_IN_DEV = originalDisable
    }
  })

  it('returns existing event when idempotency key already exists', async () => {
    const originalToken = process.env.MEMORY_API_TOKEN
    const originalDisable = process.env.DISABLE_AUTH_IN_DEV

    delete process.env.MEMORY_API_TOKEN
    process.env.DISABLE_AUTH_IN_DEV = 'true'

    try {
      const ctx = {
        db: {
          query: () => ({
            withIndex: (indexName: string, _builder: unknown) => {
              if (indexName === 'by_org_conversation_message') {
                return {
                  first: async () => ({
                    userId: 'user_1',
                    role: 'assistant',
                  }),
                }
              }
              return {
                first: async () => ({ _id: 'event_existing' }),
              }
            },
          }),
          insert: async () => {
            throw new Error('insert should not be called')
          },
        },
      }

      const result = await (recordFeedbackFromApi as any)._handler(ctx, {
        organizationId: 'org_1',
        messageId: 'msg_1',
        conversationId: 'conv_1',
        rating: 'down',
      })

      assert.equal(result.success, true)
      assert.equal(result.eventId, 'event_existing')
    } finally {
      process.env.MEMORY_API_TOKEN = originalToken
      process.env.DISABLE_AUTH_IN_DEV = originalDisable
    }
  })
})

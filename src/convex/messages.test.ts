import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getByConversation } from './messages'

interface MessageRow {
  _id: string
  createdAt: number
  organizationId: string
  conversationId: string
  userId: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

function createCtx(rows: MessageRow[]) {
  return {
    db: {
      query: () => {
        let working = [...rows]

        const chain = {
          withIndex: () => chain,
          order: (direction: 'asc' | 'desc') => {
            if (direction === 'desc') {
              working.sort((a, b) => b.createdAt - a.createdAt)
            } else {
              working.sort((a, b) => a.createdAt - b.createdAt)
            }
            return chain
          },
          filter: (
            predicate: (q: {
              field: (name: string) => string
              lt: (
                fieldName: string,
                value: number
              ) => {
                op: 'lt'
                field: string
                value: number
              }
            }) => { op: 'lt'; field: string; value: number }
          ) => {
            const expr = predicate({
              field: (name) => name,
              lt: (fieldName, value) => ({ op: 'lt', field: fieldName, value }),
            })

            if (expr.op === 'lt' && expr.field === 'createdAt') {
              working = working.filter((row) => row.createdAt < expr.value)
            }

            return chain
          },
          take: async (limit: number) => working.slice(0, limit),
        }

        return chain
      },
    },
  }
}

function seedRows(): MessageRow[] {
  return [
    {
      _id: 'm_500',
      createdAt: 500,
      organizationId: 'org_1',
      conversationId: 'conv_1',
      userId: 'user_1',
      role: 'user',
      content: 'Newest',
    },
    {
      _id: 'm_400',
      createdAt: 400,
      organizationId: 'org_1',
      conversationId: 'conv_1',
      userId: 'user_1',
      role: 'assistant',
      content: 'Older',
    },
    {
      _id: 'm_300',
      createdAt: 300,
      organizationId: 'org_1',
      conversationId: 'conv_1',
      userId: 'user_1',
      role: 'user',
      content: 'Old',
    },
    {
      _id: 'm_200',
      createdAt: 200,
      organizationId: 'org_1',
      conversationId: 'conv_1',
      userId: 'user_1',
      role: 'assistant',
      content: 'Older 2',
    },
    {
      _id: 'm_100',
      createdAt: 100,
      organizationId: 'org_1',
      conversationId: 'conv_1',
      userId: 'user_1',
      role: 'user',
      content: 'Oldest',
    },
  ]
}

describe('messages.getByConversation pagination', () => {
  it('returns first page in ascending order within the selected window', async () => {
    const ctx = createCtx(seedRows())

    const result = await (getByConversation as any)._handler(ctx, {
      organizationId: 'org_1',
      conversationId: 'conv_1',
      limit: 2,
    })

    assert.equal(result.messages.length, 2)
    assert.equal(result.messages[0]._id, 'm_400')
    assert.equal(result.messages[1]._id, 'm_500')
    assert.equal(result.nextCursor, 400)
  })

  it('applies cursor filter to fetch only older messages', async () => {
    const ctx = createCtx(seedRows())

    const result = await (getByConversation as any)._handler(ctx, {
      organizationId: 'org_1',
      conversationId: 'conv_1',
      limit: 2,
      cursor: 400,
    })

    assert.equal(result.messages.length, 2)
    assert.equal(result.messages[0]._id, 'm_200')
    assert.equal(result.messages[1]._id, 'm_300')
    assert.equal(result.nextCursor, 200)

    const hasNewerOrEqual = result.messages.some((m: MessageRow) => m.createdAt >= 400)
    assert.equal(hasNewerOrEqual, false)
  })
})

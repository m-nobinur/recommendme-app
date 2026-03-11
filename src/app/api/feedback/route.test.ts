import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { createFeedbackPostHandler } from './route'

interface FakeMessageRecord {
  userId: string
  role: 'user' | 'assistant' | 'system'
  conversationId: string
}

interface FakeRateLimitResult {
  scope: 'feedback_submit'
  key: string
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number
  retryAfterSeconds: number
}

const BASE_RATE_LIMIT: FakeRateLimitResult = {
  scope: 'feedback_submit',
  key: 'feedback_submit:test',
  allowed: true,
  limit: 20,
  remaining: 19,
  resetAt: Date.now() + 60_000,
  retryAfterSeconds: 60,
}

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

function createHandler(options: {
  isDevMode: boolean
  sessionUserId?: string
  appUser?: { _id: string; organizationId: string } | null
  rateLimit?: Partial<FakeRateLimitResult>
  message?: FakeMessageRecord | null
  mutationResult?: { eventId: string }
}) {
  let queryCalls = 0
  let mutationCalls = 0
  let mutationArgs: Record<string, unknown> | null = null

  const handler = createFeedbackPostHandler({
    isDevMode: options.isDevMode,
    memoryAuthToken: 'test-token',
    getServerSession: async () =>
      options.sessionUserId ? ({ user: { id: options.sessionUserId } } as any) : null,
    fetchAuthQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ('authUserId' in args) {
        return options.appUser ?? null
      }
      return options.message ?? null
    },
    getConvexClient: () =>
      ({
        query: async () => {
          queryCalls++
          return options.message ?? null
        },
        mutation: async (_fn: unknown, args: Record<string, unknown>) => {
          mutationCalls++
          mutationArgs = args
          return options.mutationResult ?? { eventId: 'event_1' }
        },
      }) as any,
    checkSecurityRateLimitDistributed: async () => ({
      ...BASE_RATE_LIMIT,
      ...options.rateLimit,
    }),
  })

  return {
    handler,
    getQueryCalls: () => queryCalls,
    getMutationCalls: () => mutationCalls,
    getMutationArgs: () => mutationArgs,
  }
}

afterEach(() => {
  delete process.env.DEV_USER_ID
  delete process.env.DEV_ORGANIZATION_ID
})

describe('api/feedback route', () => {
  it('returns 401 for unauthenticated requests in non-dev mode', async () => {
    const { handler } = createHandler({
      isDevMode: false,
      sessionUserId: undefined,
      appUser: null,
    })

    const res = await handler(
      buildRequest({ messageId: 'm_1', conversationId: 'c_1', rating: 'up' })
    )

    assert.equal(res.status, 401)
    const body = await readJson(res)
    assert.equal(body.error, 'Unauthorized')
  })

  it('returns 429 and retry-after when feedback limiter blocks request', async () => {
    process.env.DEV_USER_ID = 'user_1'
    process.env.DEV_ORGANIZATION_ID = 'org_1'

    const { handler } = createHandler({
      isDevMode: true,
      rateLimit: {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 42,
      },
    })

    const res = await handler(
      buildRequest({ messageId: 'm_1', conversationId: 'c_1', rating: 'down' })
    )

    assert.equal(res.status, 429)
    assert.equal(res.headers.get('Retry-After'), '42')
    const body = await readJson(res)
    assert.equal(body.error, 'Too many feedback submissions. Please try again later.')
  })

  it('returns 404 when target message does not exist', async () => {
    process.env.DEV_USER_ID = 'user_1'
    process.env.DEV_ORGANIZATION_ID = 'org_1'

    const { handler, getMutationCalls } = createHandler({
      isDevMode: true,
      message: null,
    })

    const res = await handler(
      buildRequest({ messageId: 'm_404', conversationId: 'c_1', rating: 'up' })
    )

    assert.equal(res.status, 404)
    assert.equal(getMutationCalls(), 0)
  })

  it('returns 403 when feedback targets another user message', async () => {
    process.env.DEV_USER_ID = 'user_1'
    process.env.DEV_ORGANIZATION_ID = 'org_1'

    const { handler, getMutationCalls } = createHandler({
      isDevMode: true,
      message: { userId: 'user_other', role: 'assistant', conversationId: 'c_1' },
    })

    const res = await handler(
      buildRequest({ messageId: 'm_2', conversationId: 'c_1', rating: 'up' })
    )

    assert.equal(res.status, 403)
    assert.equal(getMutationCalls(), 0)
  })

  it('returns 400 when feedback targets a non-assistant message', async () => {
    process.env.DEV_USER_ID = 'user_1'
    process.env.DEV_ORGANIZATION_ID = 'org_1'

    const { handler, getMutationCalls } = createHandler({
      isDevMode: true,
      message: { userId: 'user_1', role: 'user', conversationId: 'c_1' },
    })

    const res = await handler(
      buildRequest({ messageId: 'm_3', conversationId: 'c_1', rating: 'down' })
    )

    assert.equal(res.status, 400)
    const body = await readJson(res)
    assert.equal(body.error, 'Feedback is only allowed on assistant messages')
    assert.equal(getMutationCalls(), 0)
  })

  it('returns 200 and persists sanitized feedback payload on success', async () => {
    process.env.DEV_USER_ID = 'user_1'
    process.env.DEV_ORGANIZATION_ID = 'org_1'

    const { handler, getQueryCalls, getMutationCalls, getMutationArgs } = createHandler({
      isDevMode: true,
      message: { userId: 'user_1', role: 'assistant', conversationId: 'c_1' },
      mutationResult: { eventId: 'event_success' },
    })

    const res = await handler(
      buildRequest({
        messageId: '   m_4   ',
        conversationId: '   c_1   ',
        rating: 'up',
        comment: '  Helpful answer  ',
      })
    )

    assert.equal(res.status, 200)
    assert.equal(getQueryCalls(), 1)
    assert.equal(getMutationCalls(), 1)

    const args = getMutationArgs()
    assert.equal(args?.messageId, 'm_4')
    assert.equal(args?.conversationId, 'c_1')
    assert.equal(args?.comment, 'Helpful answer')

    const body = await readJson(res)
    assert.equal(body.success, true)
    assert.equal(body.eventId, 'event_success')
  })

  it('returns 400 for message conversation mismatch', async () => {
    process.env.DEV_USER_ID = 'user_1'
    process.env.DEV_ORGANIZATION_ID = 'org_1'

    const { handler, getMutationCalls } = createHandler({
      isDevMode: true,
      message: { userId: 'user_1', role: 'assistant', conversationId: 'c_other' },
    })

    const res = await handler(
      buildRequest({ messageId: 'm_5', conversationId: 'c_1', rating: 'up' })
    )

    assert.equal(res.status, 400)
    const body = await readJson(res)
    assert.equal(body.error, 'Message conversation mismatch')
    assert.equal(getMutationCalls(), 0)
  })
})

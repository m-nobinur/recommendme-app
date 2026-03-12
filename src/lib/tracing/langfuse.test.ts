import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildLangfuseBatch } from './langfuse'

describe('langfuse batch builder', () => {
  it('builds trace, span, and generation events', () => {
    const batch = buildLangfuseBatch({
      traceId: 'trace_123',
      organizationId: 'org_123',
      userId: 'user_123',
      spans: [
        {
          traceId: 'trace_123',
          spanId: 'span_api',
          operationName: 'chat.request',
          spanType: 'api',
          status: 'ok',
          startTime: 1_700_000_000_000,
          endTime: 1_700_000_000_100,
          durationMs: 100,
        },
      ],
      generation: {
        id: 'gen_123',
        name: 'chat.completion',
        model: 'gpt-5-mini',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCostUsd: 0.0012,
        startTimeMs: 1_700_000_000_010,
        endTimeMs: 1_700_000_000_090,
      },
    })

    assert.equal(batch.length, 3)
    assert.equal(batch[0].type, 'trace-create')
    assert.equal(batch[1].type, 'span-create')
    assert.equal(batch[2].type, 'generation-create')
  })
})

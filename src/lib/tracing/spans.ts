import type { SpanStatus, SpanType, TraceContext } from './context'

/**
 * Execute a function within a traced span. Automatically ends the span
 * and sets the status based on whether the function throws.
 */
export async function withSpan<T>(
  ctx: TraceContext,
  operationName: string,
  spanType: SpanType,
  fn: (spanId: string) => Promise<T>,
  attributes?: Record<string, unknown>,
  parentSpanId?: string
): Promise<T> {
  const spanId = ctx.startSpan(operationName, spanType, attributes, parentSpanId)
  try {
    const result = await fn(spanId)
    ctx.endSpan(spanId, 'ok')
    return result
  } catch (error) {
    ctx.endSpan(spanId, 'error', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Synchronous variant — wraps a synchronous function in a span.
 */
export function withSpanSync<T>(
  ctx: TraceContext,
  operationName: string,
  spanType: SpanType,
  fn: (spanId: string) => T,
  attributes?: Record<string, unknown>,
  parentSpanId?: string
): T {
  const spanId = ctx.startSpan(operationName, spanType, attributes, parentSpanId)
  try {
    const result = fn(spanId)
    ctx.endSpan(spanId, 'ok')
    return result
  } catch (error) {
    ctx.endSpan(spanId, 'error', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export type { SpanStatus, SpanType }

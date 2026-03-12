import { generateRequestId } from '@/lib/ai/utils/request-id'

export type SpanType = 'api' | 'llm' | 'retrieval' | 'tool' | 'agent' | 'internal'
export type SpanStatus = 'ok' | 'error'

export interface SpanData {
  traceId: string
  spanId: string
  parentSpanId?: string
  operationName: string
  spanType: SpanType
  status: SpanStatus
  startTime: number
  endTime?: number
  durationMs?: number
  attributes?: Record<string, unknown>
}

export interface ActiveSpan {
  spanId: string
  operationName: string
  spanType: SpanType
  startTime: number
  attributes: Record<string, unknown>
}

export class TraceContext {
  readonly traceId: string
  readonly organizationId?: string
  private spans: SpanData[] = []
  private activeSpans: Map<string, ActiveSpan> = new Map()

  constructor(options?: { traceId?: string; organizationId?: string }) {
    this.traceId = options?.traceId ?? generateRequestId()
    this.organizationId = options?.organizationId
  }

  startSpan(
    operationName: string,
    spanType: SpanType,
    attributes?: Record<string, unknown>,
    parentSpanId?: string
  ): string {
    const spanId = generateRequestId()
    this.activeSpans.set(spanId, {
      spanId,
      operationName,
      spanType,
      startTime: Date.now(),
      attributes: attributes ?? {},
    })
    if (parentSpanId) {
      const active = this.activeSpans.get(spanId)
      if (active) {
        active.attributes._parentSpanId = parentSpanId
      }
    }
    return spanId
  }

  endSpan(spanId: string, status: SpanStatus = 'ok', attributes?: Record<string, unknown>): void {
    const active = this.activeSpans.get(spanId)
    if (!active) return

    const endTime = Date.now()
    const parentSpanId = active.attributes._parentSpanId as string | undefined
    const mergedAttributes = { ...active.attributes, ...attributes }
    delete mergedAttributes._parentSpanId

    const span: SpanData = {
      traceId: this.traceId,
      spanId: active.spanId,
      parentSpanId,
      operationName: active.operationName,
      spanType: active.spanType,
      status,
      startTime: active.startTime,
      endTime,
      durationMs: endTime - active.startTime,
      attributes: Object.keys(mergedAttributes).length > 0 ? mergedAttributes : undefined,
    }

    this.spans.push(span)
    this.activeSpans.delete(spanId)
  }

  getCompletedSpans(): SpanData[] {
    return [...this.spans]
  }

  getActiveSpanIds(): string[] {
    return [...this.activeSpans.keys()]
  }

  endAllActive(status: SpanStatus = 'error'): void {
    for (const spanId of this.activeSpans.keys()) {
      this.endSpan(spanId, status, { autoEnded: true })
    }
  }
}

/**
 * Lightweight trace context for Convex actions that only need to
 * collect usage data without full span tracking.
 */
export interface LightTraceContext {
  traceId: string
  organizationId?: string
}

export function createLightTraceContext(
  traceId?: string,
  organizationId?: string
): LightTraceContext {
  return {
    traceId: traceId ?? generateRequestId(),
    organizationId,
  }
}

import type { SpanData } from './context'

const DEFAULT_LANGFUSE_HOST = 'https://cloud.langfuse.com'
const DEFAULT_TIMEOUT_MS = 3000

interface LangfuseConfig {
  host: string
  publicKey: string
  secretKey: string
}

export interface LangfuseGenerationUsage {
  id: string
  name: string
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd?: number
  startTimeMs: number
  endTimeMs: number
}

export interface LangfuseTraceSyncInput {
  traceId: string
  organizationId?: string
  userId?: string
  spans: SpanData[]
  generation?: LangfuseGenerationUsage
  metadata?: Record<string, unknown>
}

function getLangfuseConfig(): LangfuseConfig | null {
  const enabled =
    process.env.AI_ENABLE_LANGFUSE === 'true' || process.env.LANGFUSE_ENABLED === 'true'
  if (!enabled) {
    return null
  }

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim()
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim()
  if (!publicKey || !secretKey) {
    return null
  }

  const host = process.env.LANGFUSE_HOST?.trim() || DEFAULT_LANGFUSE_HOST
  return { host: host.replace(/\/+$/, ''), publicKey, secretKey }
}

function toIso(ms: number | undefined): string | undefined {
  if (!ms || !Number.isFinite(ms)) {
    return undefined
  }
  return new Date(ms).toISOString()
}

function sanitizeSpanAttributes(
  attributes: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!attributes) {
    return undefined
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (/(content|prompt|input|output|message|args|result)/i.test(key)) {
      sanitized[key] = '[redacted]'
      continue
    }

    if (typeof value === 'string') {
      sanitized[key] = value.slice(0, 200)
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      sanitized[key] = value
      continue
    }

    // Keep external traces compact and avoid leaking nested payloads.
    sanitized[key] = '[omitted]'
  }

  return sanitized
}

function buildBaseEvent(type: string, body: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    body,
  }
}

export function buildLangfuseBatch(input: LangfuseTraceSyncInput): Array<Record<string, unknown>> {
  const batch: Array<Record<string, unknown>> = []
  const traceTimestamp = input.spans[0]?.startTime ?? Date.now()

  batch.push(
    buildBaseEvent('trace-create', {
      id: input.traceId,
      timestamp: toIso(traceTimestamp),
      name: 'chat.request',
      userId: input.userId,
      sessionId: input.organizationId,
      metadata: {
        organizationId: input.organizationId,
        ...(input.metadata ?? {}),
      },
      environment: process.env.NODE_ENV ?? 'development',
    })
  )

  for (const span of input.spans) {
    batch.push(
      buildBaseEvent('span-create', {
        id: span.spanId,
        traceId: input.traceId,
        name: span.operationName,
        startTime: toIso(span.startTime),
        endTime: toIso(span.endTime),
        metadata: {
          spanType: span.spanType,
          status: span.status,
          parentSpanId: span.parentSpanId,
          ...(sanitizeSpanAttributes(span.attributes) ?? {}),
        },
        level: span.status === 'error' ? 'ERROR' : 'DEFAULT',
        statusMessage: span.status === 'error' ? 'Error' : undefined,
        environment: process.env.NODE_ENV ?? 'development',
      })
    )
  }

  if (input.generation) {
    batch.push(
      buildBaseEvent('generation-create', {
        id: input.generation.id,
        traceId: input.traceId,
        name: input.generation.name,
        startTime: toIso(input.generation.startTimeMs),
        endTime: toIso(input.generation.endTimeMs),
        model: input.generation.model,
        usage: {
          promptTokens: input.generation.inputTokens,
          completionTokens: input.generation.outputTokens,
          totalTokens: input.generation.totalTokens,
        },
        costDetails:
          input.generation.estimatedCostUsd !== undefined
            ? { total: input.generation.estimatedCostUsd }
            : undefined,
        environment: process.env.NODE_ENV ?? 'development',
      })
    )
  }

  return batch
}

export async function syncTraceToLangfuse(input: LangfuseTraceSyncInput): Promise<void> {
  const config = getLangfuseConfig()
  if (!config) {
    return
  }

  const batch = buildLangfuseBatch(input)
  if (batch.length === 0) {
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  try {
    const auth = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')
    const response = await fetch(`${config.host}/api/public/ingestion`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        batch,
        metadata: { source: 'recommendme-app' },
      }),
      signal: controller.signal,
    })

    if (!response.ok && response.status !== 207) {
      throw new Error(`Langfuse ingestion failed with status ${response.status}`)
    }
  } catch (error) {
    console.warn('[Reme:Trace] Langfuse sync skipped:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      traceId: input.traceId,
    })
  } finally {
    clearTimeout(timeout)
  }
}

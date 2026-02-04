/**
 * Monitoring and Observability Utilities
 * Track AI operation performance and usage
 */

export interface OperationMetrics {
  operationId: string
  /** Operation type (e.g., 'chat', 'suggestions') */
  operationType: string
  startTime: number
  endTime?: number
  duration?: number
  success: boolean
  error?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  metadata?: Record<string, unknown>
}

/**
 * In-memory metrics store (for development)
 * In production, send to observability platform
 */
const metricsStore: OperationMetrics[] = []
const MAX_METRICS_STORE = 1000 // Keep last 1000 operations

/**
 * Start tracking an operation
 *
 * @param operationType - Type of operation
 * @param operationId - Unique identifier
 * @param metadata - Additional metadata
 * @returns Function to end the operation
 */
export function startOperation(
  operationType: string,
  operationId: string,
  metadata?: Record<string, unknown>
): () => void {
  const metric: OperationMetrics = {
    operationId,
    operationType,
    startTime: Date.now(),
    success: false,
    metadata,
  }

  metricsStore.push(metric)

  if (metricsStore.length > MAX_METRICS_STORE) {
    metricsStore.shift()
  }

  return () => {
    metric.endTime = Date.now()
    metric.duration = metric.endTime - metric.startTime
    metric.success = true
  }
}

/**
 * Record a successful operation
 */
export function recordSuccess(
  operationType: string,
  operationId: string,
  duration: number,
  usage?: OperationMetrics['usage'],
  metadata?: Record<string, unknown>
): void {
  const metric: OperationMetrics = {
    operationId,
    operationType,
    startTime: Date.now() - duration,
    endTime: Date.now(),
    duration,
    success: true,
    usage,
    metadata,
  }

  metricsStore.push(metric)

  if (metricsStore.length > MAX_METRICS_STORE) {
    metricsStore.shift()
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[Reme:Metrics] ${operationType} completed:`, {
      operationId,
      duration: `${duration}ms`,
      tokens: usage?.totalTokens,
    })
  }
}

/**
 * Record a failed operation
 */
export function recordError(
  operationType: string,
  operationId: string,
  duration: number,
  error: string,
  metadata?: Record<string, unknown>
): void {
  const metric: OperationMetrics = {
    operationId,
    operationType,
    startTime: Date.now() - duration,
    endTime: Date.now(),
    duration,
    success: false,
    error,
    metadata,
  }

  metricsStore.push(metric)

  if (metricsStore.length > MAX_METRICS_STORE) {
    metricsStore.shift()
  }

  console.error(`[Reme:Metrics] ${operationType} failed:`, {
    operationId,
    duration: `${duration}ms`,
    error,
  })
}

/**
 * Get metrics for a specific operation type
 */
export function getMetrics(operationType?: string): OperationMetrics[] {
  if (!operationType) {
    return [...metricsStore]
  }
  return metricsStore.filter((m) => m.operationType === operationType)
}

/**
 * Get aggregated statistics
 */
export function getStatistics(operationType?: string) {
  const metrics = getMetrics(operationType)

  if (metrics.length === 0) {
    return null
  }

  const successful = metrics.filter((m) => m.success)
  const failed = metrics.filter((m) => !m.success)
  const durations = metrics.filter((m) => m.duration !== undefined).map((m) => m.duration as number)
  const tokens = metrics
    .filter((m) => m.usage?.totalTokens !== undefined)
    .map((m) => m.usage?.totalTokens as number)

  return {
    total: metrics.length,
    successful: successful.length,
    failed: failed.length,
    successRate: (successful.length / metrics.length) * 100,
    avgDuration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    minDuration: durations.length > 0 ? Math.min(...durations) : 0,
    maxDuration: durations.length > 0 ? Math.max(...durations) : 0,
    avgTokens: tokens.length > 0 ? tokens.reduce((a, b) => a + b, 0) / tokens.length : 0,
    totalTokens: tokens.reduce((a, b) => a + b, 0),
  }
}

/**
 * Clear all metrics
 */
export function clearMetrics(): void {
  metricsStore.length = 0
}

/**
 * Log statistics for a specific operation type
 */
export function logStatistics(operationType?: string): void {
  const stats = getStatistics(operationType)
  if (!stats) {
    console.log('[Reme:Metrics] No metrics available')
    return
  }

  console.log(`[Reme:Metrics] Statistics${operationType ? ` for ${operationType}` : ''}:`, {
    total: stats.total,
    successRate: `${stats.successRate.toFixed(1)}%`,
    avgDuration: `${stats.avgDuration.toFixed(0)}ms`,
    avgTokens: stats.avgTokens.toFixed(0),
    totalTokens: stats.totalTokens,
  })
}

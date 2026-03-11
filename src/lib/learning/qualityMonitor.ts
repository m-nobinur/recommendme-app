import type {
  QualityAlert,
  QualityMetric,
  QualityMetricName,
  QualitySnapshot,
} from '../../types/learning'

const ALERT_DROP_THRESHOLD_PERCENT = 10
const ALERT_WINDOW_MS = 24 * 60 * 60 * 1000

const METRIC_WEIGHTS: Record<QualityMetricName, number> = {
  relevance: 0.3,
  accuracy: 0.25,
  freshness: 0.2,
  retrieval_precision: 0.15,
  recall: 0.1,
}

export interface MemoryStats {
  totalActive: number
  totalArchived: number
  avgConfidence: number
  avgDecayScore: number
  avgAccessCount: number
  recentAccessCount: number
  staleCount: number
  highConfidenceCount: number
  lowConfidenceCount: number
  totalWithEmbedding: number
}

export interface RetrievalStats {
  totalQueries: number
  avgResultsReturned: number
  avgTopScore: number
  emptyResultCount: number
}

export function computeRelevanceScore(stats: MemoryStats): number {
  if (stats.totalActive === 0) return 0

  const accessRatio =
    stats.totalActive > 0 ? Math.min(stats.recentAccessCount / stats.totalActive, 1.0) : 0
  const confidenceContribution = stats.avgConfidence
  const decayContribution = stats.avgDecayScore

  return Math.min(1.0, accessRatio * 0.4 + confidenceContribution * 0.35 + decayContribution * 0.25)
}

export function computeAccuracyScore(stats: MemoryStats): number {
  if (stats.totalActive === 0) return 0

  const highConfRatio = stats.highConfidenceCount / stats.totalActive
  const lowConfPenalty = stats.lowConfidenceCount / stats.totalActive

  return Math.min(1.0, Math.max(0, highConfRatio * 0.7 + (1 - lowConfPenalty) * 0.3))
}

export function computeFreshnessScore(stats: MemoryStats): number {
  if (stats.totalActive === 0) return 0

  const staleRatio = stats.staleCount / stats.totalActive
  const decayHealth = stats.avgDecayScore

  return Math.min(1.0, Math.max(0, (1 - staleRatio) * 0.6 + decayHealth * 0.4))
}

export function computeRetrievalPrecisionScore(retrievalStats: RetrievalStats): number {
  if (retrievalStats.totalQueries === 0) return 1.0

  const emptyRatio = retrievalStats.emptyResultCount / retrievalStats.totalQueries
  const scoreContribution = Math.min(retrievalStats.avgTopScore, 1.0)

  return Math.min(1.0, Math.max(0, (1 - emptyRatio) * 0.5 + scoreContribution * 0.5))
}

export function computeRecallScore(stats: MemoryStats, retrievalStats: RetrievalStats): number {
  if (stats.totalActive === 0) return 0

  const embeddingCoverage = stats.totalActive > 0 ? stats.totalWithEmbedding / stats.totalActive : 0
  const avgResults =
    retrievalStats.totalQueries > 0 ? Math.min(retrievalStats.avgResultsReturned / 5, 1.0) : 0.5

  return Math.min(1.0, embeddingCoverage * 0.6 + avgResults * 0.4)
}

export function computeQualityMetrics(
  stats: MemoryStats,
  retrievalStats: RetrievalStats,
  previousMetrics: QualityMetric[]
): QualityMetric[] {
  const now = Date.now()
  const prevMap = new Map(previousMetrics.map((m) => [m.name, m.value]))

  const metricValues: Record<QualityMetricName, number> = {
    relevance: computeRelevanceScore(stats),
    accuracy: computeAccuracyScore(stats),
    freshness: computeFreshnessScore(stats),
    retrieval_precision: computeRetrievalPrecisionScore(retrievalStats),
    recall: computeRecallScore(stats, retrievalStats),
  }

  return (Object.entries(metricValues) as [QualityMetricName, number][]).map(
    ([name, value]): QualityMetric => {
      const prev = prevMap.get(name) ?? value
      return {
        name,
        value,
        previousValue: prev,
        delta: value - prev,
        timestamp: now,
      }
    }
  )
}

export function computeOverallScore(metrics: QualityMetric[]): number {
  let totalWeight = 0
  let weightedSum = 0

  for (const metric of metrics) {
    const weight = METRIC_WEIGHTS[metric.name] ?? 0
    weightedSum += metric.value * weight
    totalWeight += weight
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0
}

export function checkForAlerts(
  metrics: QualityMetric[],
  dropThresholdPercent: number = ALERT_DROP_THRESHOLD_PERCENT
): QualityAlert[] {
  const alerts: QualityAlert[] = []

  for (const metric of metrics) {
    if (metric.previousValue <= 0) continue
    const dropPercent = ((metric.previousValue - metric.value) / metric.previousValue) * 100

    if (dropPercent >= dropThresholdPercent) {
      alerts.push({
        metric: metric.name,
        currentValue: metric.value,
        previousValue: metric.previousValue,
        dropPercent,
        timestamp: metric.timestamp,
      })
    }
  }

  return alerts
}

export function createQualitySnapshot(
  organizationId: string,
  stats: MemoryStats,
  retrievalStats: RetrievalStats,
  previousMetrics: QualityMetric[]
): QualitySnapshot {
  const metrics = computeQualityMetrics(stats, retrievalStats, previousMetrics)
  const overallScore = computeOverallScore(metrics)
  const alerts = checkForAlerts(metrics)
  const alertTriggered = alerts.length > 0
  const alertReason = alertTriggered
    ? alerts.map((a) => `${a.metric} dropped ${a.dropPercent.toFixed(1)}%`).join('; ')
    : undefined

  return {
    organizationId,
    metrics,
    overallScore,
    alertTriggered,
    alertReason,
    timestamp: Date.now(),
  }
}

export function formatQualityReport(snapshot: QualitySnapshot): string {
  const lines = [
    `Memory Quality Report (${new Date(snapshot.timestamp).toISOString()})`,
    `Overall Score: ${(snapshot.overallScore * 100).toFixed(1)}%`,
    '',
    'Metrics:',
  ]

  for (const m of snapshot.metrics) {
    const arrow = m.delta > 0 ? '↑' : m.delta < 0 ? '↓' : '→'
    const deltaStr = m.delta !== 0 ? ` (${arrow} ${(Math.abs(m.delta) * 100).toFixed(1)}%)` : ''
    lines.push(`  ${m.name}: ${(m.value * 100).toFixed(1)}%${deltaStr}`)
  }

  if (snapshot.alertTriggered && snapshot.alertReason) {
    lines.push('')
    lines.push(`⚠ ALERT: ${snapshot.alertReason}`)
  }

  return lines.join('\n')
}

export { ALERT_DROP_THRESHOLD_PERCENT, ALERT_WINDOW_MS, METRIC_WEIGHTS }

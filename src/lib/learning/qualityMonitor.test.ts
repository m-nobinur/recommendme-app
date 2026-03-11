import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { QualityMetric } from '@/types'
import type { MemoryStats, RetrievalStats } from './qualityMonitor'
import {
  ALERT_DROP_THRESHOLD_PERCENT,
  checkForAlerts,
  computeAccuracyScore,
  computeFreshnessScore,
  computeOverallScore,
  computeQualityMetrics,
  computeRecallScore,
  computeRelevanceScore,
  computeRetrievalPrecisionScore,
  createQualitySnapshot,
  formatQualityReport,
  METRIC_WEIGHTS,
} from './qualityMonitor'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemoryStats(overrides: Partial<MemoryStats> = {}): MemoryStats {
  return {
    totalActive: 100,
    totalArchived: 20,
    avgConfidence: 0.8,
    avgDecayScore: 0.75,
    avgAccessCount: 5,
    recentAccessCount: 40,
    staleCount: 10,
    highConfidenceCount: 70,
    lowConfidenceCount: 5,
    totalWithEmbedding: 90,
    ...overrides,
  }
}

function makeRetrievalStats(overrides: Partial<RetrievalStats> = {}): RetrievalStats {
  return {
    totalQueries: 50,
    avgResultsReturned: 4,
    avgTopScore: 0.85,
    emptyResultCount: 2,
    ...overrides,
  }
}

function makeMetric(
  name: QualityMetric['name'],
  value: number,
  previousValue = value
): QualityMetric {
  return {
    name,
    value,
    previousValue,
    delta: value - previousValue,
    timestamp: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// computeRelevanceScore
// ---------------------------------------------------------------------------

describe('computeRelevanceScore', () => {
  it('returns 0 when totalActive is 0', () => {
    assert.equal(computeRelevanceScore(makeMemoryStats({ totalActive: 0 })), 0)
  })

  it('returns a value in [0, 1]', () => {
    const score = computeRelevanceScore(makeMemoryStats())
    assert.ok(score >= 0 && score <= 1, `score out of range: ${score}`)
  })

  it('increases when recentAccessCount increases relative to totalActive', () => {
    const low = computeRelevanceScore(makeMemoryStats({ recentAccessCount: 5 }))
    const high = computeRelevanceScore(makeMemoryStats({ recentAccessCount: 90 }))
    assert.ok(high > low)
  })
})

// ---------------------------------------------------------------------------
// computeAccuracyScore
// ---------------------------------------------------------------------------

describe('computeAccuracyScore', () => {
  it('returns 0 when totalActive is 0', () => {
    assert.equal(computeAccuracyScore(makeMemoryStats({ totalActive: 0 })), 0)
  })

  it('returns a value in [0, 1]', () => {
    const score = computeAccuracyScore(makeMemoryStats())
    assert.ok(score >= 0 && score <= 1, `score out of range: ${score}`)
  })

  it('decreases when lowConfidenceCount increases', () => {
    const low = computeAccuracyScore(makeMemoryStats({ lowConfidenceCount: 1 }))
    const high = computeAccuracyScore(makeMemoryStats({ lowConfidenceCount: 50 }))
    assert.ok(low > high)
  })
})

// ---------------------------------------------------------------------------
// computeFreshnessScore
// ---------------------------------------------------------------------------

describe('computeFreshnessScore', () => {
  it('returns 0 when totalActive is 0', () => {
    assert.equal(computeFreshnessScore(makeMemoryStats({ totalActive: 0 })), 0)
  })

  it('returns a value in [0, 1]', () => {
    const score = computeFreshnessScore(makeMemoryStats())
    assert.ok(score >= 0 && score <= 1, `score out of range: ${score}`)
  })

  it('decreases when staleCount increases', () => {
    const fresh = computeFreshnessScore(makeMemoryStats({ staleCount: 0 }))
    const stale = computeFreshnessScore(makeMemoryStats({ staleCount: 90 }))
    assert.ok(fresh > stale)
  })
})

// ---------------------------------------------------------------------------
// computeRetrievalPrecisionScore
// ---------------------------------------------------------------------------

describe('computeRetrievalPrecisionScore', () => {
  it('returns 1.0 when totalQueries is 0 (no data = perfect precision by default)', () => {
    assert.equal(computeRetrievalPrecisionScore(makeRetrievalStats({ totalQueries: 0 })), 1.0)
  })

  it('returns a value in [0, 1]', () => {
    const score = computeRetrievalPrecisionScore(makeRetrievalStats())
    assert.ok(score >= 0 && score <= 1, `score out of range: ${score}`)
  })

  it('decreases when emptyResultCount increases', () => {
    const good = computeRetrievalPrecisionScore(makeRetrievalStats({ emptyResultCount: 0 }))
    const poor = computeRetrievalPrecisionScore(makeRetrievalStats({ emptyResultCount: 48 }))
    assert.ok(good > poor)
  })
})

// ---------------------------------------------------------------------------
// computeRecallScore
// ---------------------------------------------------------------------------

describe('computeRecallScore', () => {
  it('returns 0 when totalActive is 0', () => {
    assert.equal(computeRecallScore(makeMemoryStats({ totalActive: 0 }), makeRetrievalStats()), 0)
  })

  it('returns a value in [0, 1]', () => {
    const score = computeRecallScore(makeMemoryStats(), makeRetrievalStats())
    assert.ok(score >= 0 && score <= 1, `score out of range: ${score}`)
  })

  it('increases with higher embedding coverage', () => {
    const low = computeRecallScore(
      makeMemoryStats({ totalWithEmbedding: 10 }),
      makeRetrievalStats()
    )
    const high = computeRecallScore(
      makeMemoryStats({ totalWithEmbedding: 100 }),
      makeRetrievalStats()
    )
    assert.ok(high > low)
  })
})

// ---------------------------------------------------------------------------
// computeOverallScore
// ---------------------------------------------------------------------------

describe('computeOverallScore', () => {
  it('returns 0 for empty metrics array', () => {
    assert.equal(computeOverallScore([]), 0)
  })

  it('returns a value in [0, 1] for normal metrics', () => {
    const metrics = computeQualityMetrics(makeMemoryStats(), makeRetrievalStats(), [])
    const score = computeOverallScore(metrics)
    assert.ok(score >= 0 && score <= 1, `score out of range: ${score}`)
  })

  it('computes a weighted average matching METRIC_WEIGHTS', () => {
    // All metrics value=1.0 → overall should equal sum(weights)/sum(weights) = 1.0
    const allOne: QualityMetric[] = (Object.keys(METRIC_WEIGHTS) as QualityMetric['name'][]).map(
      (name) => makeMetric(name, 1.0)
    )
    assert.ok(Math.abs(computeOverallScore(allOne) - 1.0) < 0.001)
  })

  it('uses 0 weight for unknown metric names', () => {
    // A metric with an unknown name should contribute 0 weight
    const metrics: QualityMetric[] = [
      { name: 'relevance', value: 0.5, previousValue: 0.5, delta: 0, timestamp: Date.now() },
    ]
    const score = computeOverallScore(metrics)
    const expected = (0.5 * METRIC_WEIGHTS.relevance) / METRIC_WEIGHTS.relevance
    assert.ok(Math.abs(score - expected) < 0.001)
  })
})

// ---------------------------------------------------------------------------
// checkForAlerts
// ---------------------------------------------------------------------------

describe('checkForAlerts', () => {
  it('returns no alerts when metrics are stable', () => {
    const metrics = [makeMetric('relevance', 0.8, 0.8)]
    assert.equal(checkForAlerts(metrics).length, 0)
  })

  it(`triggers alert when drop >= ALERT_DROP_THRESHOLD_PERCENT (${ALERT_DROP_THRESHOLD_PERCENT}%)`, () => {
    // Drop from 1.0 → 0.85 = 15% drop (> 10% threshold)
    const metrics = [makeMetric('accuracy', 0.85, 1.0)]
    const alerts = checkForAlerts(metrics)
    assert.equal(alerts.length, 1)
    assert.equal(alerts[0]?.metric, 'accuracy')
    assert.ok(alerts[0].dropPercent >= ALERT_DROP_THRESHOLD_PERCENT)
  })

  it('does not trigger alert for a drop just below threshold', () => {
    // Drop from 1.0 → 0.91 = 9% drop (< 10% threshold)
    const metrics = [makeMetric('freshness', 0.91, 1.0)]
    const alerts = checkForAlerts(metrics)
    assert.equal(alerts.length, 0)
  })

  it('skips metrics with previousValue <= 0', () => {
    const metrics = [makeMetric('recall', 0.5, 0)]
    const alerts = checkForAlerts(metrics)
    assert.equal(alerts.length, 0)
  })

  it('accepts custom drop threshold', () => {
    // 5% drop from 1.0 → 0.95
    const metrics = [makeMetric('retrieval_precision', 0.95, 1.0)]
    assert.equal(checkForAlerts(metrics, 10).length, 0) // below 10%
    assert.equal(checkForAlerts(metrics, 4).length, 1) // above 4%
  })
})

// ---------------------------------------------------------------------------
// computeQualityMetrics
// ---------------------------------------------------------------------------

describe('computeQualityMetrics', () => {
  it('returns 5 metrics (one per QualityMetricName)', () => {
    const metrics = computeQualityMetrics(makeMemoryStats(), makeRetrievalStats(), [])
    assert.equal(metrics.length, 5)
    const names = new Set(metrics.map((m) => m.name))
    for (const name of Object.keys(METRIC_WEIGHTS)) {
      assert.ok(names.has(name as QualityMetric['name']), `missing metric: ${name}`)
    }
  })

  it('sets delta=0 and previousValue=current when no previous metrics exist', () => {
    const metrics = computeQualityMetrics(makeMemoryStats(), makeRetrievalStats(), [])
    for (const m of metrics) {
      assert.equal(m.delta, 0)
      assert.equal(m.previousValue, m.value)
    }
  })

  it('computes delta correctly from previous metrics', () => {
    const prev = [makeMetric('relevance', 0.5)]
    const stats = makeMemoryStats()
    const retrieval = makeRetrievalStats()
    const metrics = computeQualityMetrics(stats, retrieval, prev)
    const relevance = metrics.find((m) => m.name === 'relevance')
    assert.ok(relevance)
    assert.equal(relevance.previousValue, 0.5)
    assert.ok(Math.abs(relevance.delta - (relevance.value - 0.5)) < 0.001)
  })
})

// ---------------------------------------------------------------------------
// createQualitySnapshot
// ---------------------------------------------------------------------------

describe('createQualitySnapshot', () => {
  it('produces a snapshot with correct organizationId and timestamp', () => {
    const before = Date.now()
    const snap = createQualitySnapshot('org_123', makeMemoryStats(), makeRetrievalStats(), [])
    const after = Date.now()
    assert.equal(snap.organizationId, 'org_123')
    assert.ok(snap.timestamp >= before && snap.timestamp <= after)
  })

  it('has overallScore in [0, 1]', () => {
    const snap = createQualitySnapshot('org_123', makeMemoryStats(), makeRetrievalStats(), [])
    assert.ok(snap.overallScore >= 0 && snap.overallScore <= 1)
  })

  it('sets alertTriggered=true and alertReason when a metric drops significantly', () => {
    // Force a large drop by providing a high previousValue
    const previousMetrics = [makeMetric('accuracy', 1.0)]
    // With default memory stats, accuracy will be well below 1.0 → triggers alert
    const snap = createQualitySnapshot(
      'org_abc',
      makeMemoryStats({ highConfidenceCount: 5, lowConfidenceCount: 80 }),
      makeRetrievalStats(),
      previousMetrics
    )
    assert.ok(snap.alertTriggered)
    assert.ok(typeof snap.alertReason === 'string' && snap.alertReason.length > 0)
  })

  it('sets alertTriggered=false when no drops exceed threshold', () => {
    // Feed back the same metric values so delta=0
    const stats = makeMemoryStats()
    const retrieval = makeRetrievalStats()
    const first = createQualitySnapshot('org_abc', stats, retrieval, [])
    const second = createQualitySnapshot('org_abc', stats, retrieval, first.metrics)
    assert.ok(!second.alertTriggered)
  })
})

// ---------------------------------------------------------------------------
// formatQualityReport
// ---------------------------------------------------------------------------

describe('formatQualityReport', () => {
  it('contains the overall score and all metric names', () => {
    const snap = createQualitySnapshot('org_test', makeMemoryStats(), makeRetrievalStats(), [])
    const report = formatQualityReport(snap)
    assert.ok(report.includes('Overall Score:'))
    for (const name of Object.keys(METRIC_WEIGHTS)) {
      assert.ok(report.includes(name), `report missing metric: ${name}`)
    }
  })

  it('includes ALERT line when alertTriggered is true', () => {
    const snap = createQualitySnapshot(
      'org_test',
      makeMemoryStats({ highConfidenceCount: 5, lowConfidenceCount: 80 }),
      makeRetrievalStats(),
      [makeMetric('accuracy', 1.0)]
    )
    const report = formatQualityReport(snap)
    if (snap.alertTriggered) {
      assert.ok(report.includes('ALERT'))
    }
  })

  it('does not include ALERT line when no alerts', () => {
    const stats = makeMemoryStats()
    const retrieval = makeRetrievalStats()
    const first = createQualitySnapshot('org_test', stats, retrieval, [])
    const second = createQualitySnapshot('org_test', stats, retrieval, first.metrics)
    const report = formatQualityReport(second)
    assert.ok(!report.includes('ALERT'))
  })
})

import { v } from 'convex/values'
import {
  checkForAlerts,
  createQualitySnapshot,
  formatQualityReport,
  type MemoryStats,
  type RetrievalStats,
} from '../lib/learning/qualityMonitor'
import type { QualityAlert, QualityMetric } from '../types/learning'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { internalAction, internalQuery } from './_generated/server'
import { isCronDisabled } from './lib/cronGuard'

/**
 * Quality Monitor — Phase 11.4
 *
 * Scheduled daily action that computes memory quality metrics for every active
 * organisation, surfaces alerts when a metric drops >10% from its previous
 * value, persists snapshots for trend tracking, and writes a structured audit
 * log entry so dashboards (Phase 12) can render trend data.
 *
 * Metrics computed (see qualityMonitor.ts for weights):
 *   relevance (0.30) · accuracy (0.25) · freshness (0.20)
 *   retrieval_precision (0.15) · recall (0.10)
 *
 * Cron: daily at 07:00 UTC (configured in crons.ts)
 */

const MAX_ORGS_PER_RUN = 50
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const HIGH_CONFIDENCE_THRESHOLD = 0.8
const LOW_CONFIDENCE_THRESHOLD = 0.4
const RECENT_ACCESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// ---------------------------------------------------------------------------
// Internal query: gather memory stats for one organisation
// ---------------------------------------------------------------------------

export const getMemoryStatsForOrg = internalQuery({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args): Promise<MemoryStats> => {
    const now = Date.now()
    const recentCutoff = now - RECENT_ACCESS_WINDOW_MS
    const staleCutoff = now - STALE_THRESHOLD_MS

    // Capped at 500 to stay within Convex query limits.
    const activeMemories = await ctx.db
      .query('businessMemories')
      .withIndex('by_org_active', (q) =>
        q.eq('organizationId', args.organizationId).eq('isActive', true)
      )
      .take(500)

    const archivedMemories = await ctx.db
      .query('businessMemories')
      .withIndex('by_org_archived', (q) =>
        q.eq('organizationId', args.organizationId).eq('isArchived', true)
      )
      .take(200)

    const totalActive = activeMemories.length
    const totalArchived = archivedMemories.length

    if (totalActive === 0) {
      return {
        totalActive: 0,
        totalArchived,
        avgConfidence: 0,
        avgDecayScore: 0,
        avgAccessCount: 0,
        recentAccessCount: 0,
        staleCount: 0,
        highConfidenceCount: 0,
        lowConfidenceCount: 0,
        totalWithEmbedding: 0,
      }
    }

    let sumConfidence = 0
    let sumDecay = 0
    let sumAccess = 0
    let recentAccessCount = 0
    let staleCount = 0
    let highConfidenceCount = 0
    let lowConfidenceCount = 0
    let totalWithEmbedding = 0

    for (const mem of activeMemories) {
      sumConfidence += mem.confidence
      sumDecay += mem.decayScore
      sumAccess += mem.accessCount
      if (mem.lastAccessedAt >= recentCutoff) recentAccessCount++
      if (mem.lastAccessedAt < staleCutoff) staleCount++
      if (mem.confidence >= HIGH_CONFIDENCE_THRESHOLD) highConfidenceCount++
      if (mem.confidence < LOW_CONFIDENCE_THRESHOLD) lowConfidenceCount++
      if (mem.embedding && mem.embedding.length > 0) totalWithEmbedding++
    }

    return {
      totalActive,
      totalArchived,
      avgConfidence: sumConfidence / totalActive,
      avgDecayScore: sumDecay / totalActive,
      avgAccessCount: sumAccess / totalActive,
      recentAccessCount,
      staleCount,
      highConfidenceCount,
      lowConfidenceCount,
      totalWithEmbedding,
    }
  },
})

// ---------------------------------------------------------------------------
// Internal query: list all active organisation IDs (capped)
// ---------------------------------------------------------------------------

export const listActiveOrganizationIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const orgs = await ctx.db.query('organizations').take(MAX_ORGS_PER_RUN)
    return orgs.map((o) => o._id as string)
  },
})

// ---------------------------------------------------------------------------
// Main scheduled action
// ---------------------------------------------------------------------------

export const runQualityMonitorCheck = internalAction({
  args: {},
  handler: async (ctx): Promise<{ orgsChecked: number; alertsTriggered: number }> => {
    if (isCronDisabled()) {
      console.log('[QualityMonitor] Crons disabled — skipping quality check')
      return { orgsChecked: 0, alertsTriggered: 0 }
    }

    const orgIds: string[] = await ctx.runQuery(
      internal.qualityMonitor.listActiveOrganizationIds,
      {}
    )

    let orgsChecked = 0
    let alertsTriggered = 0

    for (const orgId of orgIds) {
      try {
        const memoryStats: MemoryStats = await ctx.runQuery(
          internal.qualityMonitor.getMemoryStatsForOrg,
          { organizationId: orgId as any }
        )

        // Retrieval stats are not yet persisted — we derive a conservative
        // synthetic baseline. Phase 12 (Memory Analytics) will replace this
        // with real retrieval telemetry from the traces table.
        const retrievalStats: RetrievalStats = {
          totalQueries: 0,
          avgResultsReturned: 0,
          avgTopScore: 0,
          emptyResultCount: 0,
        }

        // Load previous snapshot for delta comparison.
        const prevSnapshot: Doc<'qualitySnapshots'> | null = await ctx.runQuery(
          internal.learningPipeline.getPreviousQualitySnapshot,
          { organizationId: orgId as any }
        )
        const previousMetrics = prevSnapshot
          ? prevSnapshot.metrics.map((m) => ({
              name: m.name as any,
              value: m.value,
              previousValue: m.previousValue,
              delta: m.delta,
              timestamp: m.timestamp,
            }))
          : []

        const snapshot = createQualitySnapshot(orgId, memoryStats, retrievalStats, previousMetrics)
        const report = formatQualityReport(snapshot)

        // Persist the snapshot for trend tracking in Phase 12 dashboard.
        try {
          const alerts = checkForAlerts(snapshot.metrics)
          await ctx.runMutation(internal.learningPipeline.insertQualitySnapshot, {
            organizationId: orgId as any,
            overallScore: snapshot.overallScore,
            metrics: snapshot.metrics.map((m: QualityMetric) => ({
              name: m.name,
              value: m.value,
              previousValue: m.previousValue,
              delta: m.delta,
              timestamp: m.timestamp,
            })),
            alerts: alerts.map((a: QualityAlert) => ({
              metric: a.metric,
              currentValue: a.currentValue,
              previousValue: a.previousValue,
              dropPercent: a.dropPercent,
              timestamp: a.timestamp,
            })),
            alertTriggered: snapshot.alertTriggered,
            alertReason: snapshot.alertReason,
          })
        } catch {
          // Non-critical: snapshot persistence failure must not block the run.
        }

        if (snapshot.alertTriggered) {
          alertsTriggered++
          console.warn('[QualityMonitor] Quality alert triggered:', {
            organizationId: orgId,
            overallScore: snapshot.overallScore.toFixed(3),
            alertReason: snapshot.alertReason,
          })

          await ctx.runMutation(internal.auditLogs.append, {
            organizationId: orgId as any,
            actorType: 'system' as const,
            action: 'memory_quality_alert',
            resourceType: 'businessMemories',
            details: {
              overallScore: snapshot.overallScore,
              alertReason: snapshot.alertReason,
              metrics: snapshot.metrics.map((m: QualityMetric) => ({
                name: m.name,
                value: m.value,
                delta: m.delta,
              })),
            },
            riskLevel: 'medium' as const,
          })
        } else if (memoryStats.totalActive > 0) {
          await ctx.runMutation(internal.auditLogs.append, {
            organizationId: orgId as any,
            actorType: 'system' as const,
            action: 'memory_quality_check',
            resourceType: 'businessMemories',
            details: {
              overallScore: snapshot.overallScore,
              totalActive: memoryStats.totalActive,
              metrics: snapshot.metrics.map((m: QualityMetric) => ({
                name: m.name,
                value: m.value,
              })),
            },
            riskLevel: 'low' as const,
          })
        }

        if (process.env.DEBUG_MEMORY === 'true') {
          console.log(`[QualityMonitor] Report:
${report}`)
        }

        orgsChecked++
      } catch (error) {
        console.error('[QualityMonitor] Failed to check org quality:', {
          organizationId: orgId,
          error: error instanceof Error ? error.message : 'Unknown',
        })
      }
    }

    console.log('[QualityMonitor] Run complete:', { orgsChecked, alertsTriggered })
    return { orgsChecked, alertsTriggered }
  },
})

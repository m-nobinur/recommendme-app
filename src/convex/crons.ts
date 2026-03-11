import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

/**
 * Cron Job Definitions
 *
 * To disable all crons during development (saves Convex bandwidth):
 *   Set DISABLE_CRONS=true in your Convex environment variables via:
 *     npx convex env set DISABLE_CRONS true
 *
 * To re-enable:
 *     npx convex env set DISABLE_CRONS false
 *   or:
 *     npx convex env unset DISABLE_CRONS
 *
 * Schedule (production):
 *   - Memory extraction:       every 30 min (LLM-based knowledge extraction)
 *   - Decay score update:      every 4 hours (Ebbinghaus decay recalculation)
 *   - Memory archival:         daily 8:00 UTC (archive decayed memories)
 *   - Memory compression:      daily 8:15 UTC (compress archived groups)
 *   - Memory cleanup:          weekly Sun 8:00 UTC (purge expired, hard-delete, orphan cleanup)
 *   - Lifecycle health:        every 12 hours (backlog/sanity checks)
 *   - Stuck recovery:          every 30 min (reset stuck events)
 *   - Memory consolidation:    daily 8:30 UTC (merge near-duplicate memories)
 *   - Niche aggregation:       daily 9:00 UTC (business → niche pattern promotion)
 *   - Platform aggregation:    weekly Sun 7:00 UTC (niche → platform promotion)
 *   - Daily analytics:         daily 6:00 UTC (pre-computed analytics snapshots)
 *   - Pattern detection:       every 6 hours (cross-conversation pattern accumulation)
 *   - Failure learning:        every 2 hours (failure analysis and prevention rule creation)
 *   - Quality monitor:         daily 07:00 UTC (memory quality snapshots)
 *   - Followup agent:          daily 14:00 UTC
 *   - Reminder agent:          daily 09:00 UTC
 *   - Invoice agent:           daily 10:00 UTC
 *   - Sales funnel agent:      daily 11:00 UTC
 */

const crons = cronJobs()

crons.interval(
  'memory extraction pipeline',
  { minutes: 30 },
  internal.memoryExtraction.processExtractionBatch,
  {}
)

crons.interval('decay score update', { hours: 4 }, internal.memoryDecay.runDecayUpdate, {})

crons.daily(
  'memory archival',
  { hourUTC: 8, minuteUTC: 0 },
  internal.memoryArchival.archiveDecayedMemories,
  {}
)

crons.daily(
  'memory compression',
  { hourUTC: 8, minuteUTC: 15 },
  internal.memoryArchival.compressArchivedMemories,
  {}
)

crons.weekly(
  'memory cleanup',
  { dayOfWeek: 'sunday', hourUTC: 8, minuteUTC: 0 },
  internal.memoryArchival.purgeExpiredMemories,
  {}
)

crons.interval(
  'memory lifecycle health check',
  { hours: 12 },
  internal.memoryArchival.lifecycleHealthCheck,
  {}
)

crons.interval(
  'recover stuck processing events',
  { minutes: 30 },
  internal.memoryEvents.recoverStuckProcessingEvents,
  {}
)

// ============================================
// PHASE 8: Worker Architecture & Background Jobs
// ============================================

crons.daily(
  'memory consolidation',
  { hourUTC: 8, minuteUTC: 30 },
  internal.memoryConsolidation.runConsolidation,
  {}
)

crons.daily(
  'niche pattern aggregation',
  { hourUTC: 9, minuteUTC: 0 },
  internal.nicheAggregation.runNicheAggregation,
  {}
)

crons.weekly(
  'platform pattern aggregation',
  { dayOfWeek: 'sunday', hourUTC: 7, minuteUTC: 0 },
  internal.platformAggregation.runPlatformAggregation,
  {}
)

crons.daily(
  'daily analytics snapshot',
  { hourUTC: 6, minuteUTC: 0 },
  internal.analyticsWorker.runDailyAnalytics,
  {}
)

// ============================================
// GUARDRAILS: Approval Queue Maintenance
// ============================================

crons.interval(
  'expire stale pending approvals',
  { minutes: 30 },
  internal.approvalQueue.expireStalePending,
  {}
)

crons.interval(
  'purge expired security rate limits',
  { hours: 1 },
  internal.security.purgeExpiredRateLimits,
  {}
)

// ============================================
// OBSERVABILITY: Trace & Usage Cleanup
// ============================================

crons.weekly(
  'purge old traces',
  { dayOfWeek: 'sunday', hourUTC: 6, minuteUTC: 0 },
  internal.traces.purgeOldTraces,
  {}
)

crons.monthly(
  'purge old LLM usage',
  { day: 1, hourUTC: 6, minuteUTC: 30 },
  internal.llmUsage.purgeOldUsage,
  {}
)

// ============================================
// AGENT FRAMEWORK: Scheduled Agent Runs
// ============================================

crons.daily(
  'followup agent',
  { hourUTC: 14, minuteUTC: 0 },
  internal.agentRunner.runFollowupAgent,
  {}
)

crons.daily(
  'reminder agent',
  { hourUTC: 9, minuteUTC: 0 },
  internal.agentRunner.runReminderAgent,
  {}
)

crons.daily(
  'invoice agent',
  { hourUTC: 10, minuteUTC: 0 },
  internal.agentRunner.runInvoiceAgent,
  {}
)

crons.daily(
  'sales funnel agent',
  { hourUTC: 11, minuteUTC: 0 },
  internal.agentRunner.runSalesAgent,
  {}
)

// ============================================
// LEARNING: Pattern Detection, Failure Learning, Quality Monitoring
// ============================================

crons.interval(
  'pattern detection pipeline',
  { hours: 6 },
  internal.learningPipeline.runPatternDetectionBatch,
  {}
)

crons.interval(
  'failure learning pipeline',
  { hours: 2 },
  internal.learningPipeline.runFailureLearningBatch,
  {}
)

crons.daily(
  'memory quality monitor',
  { hourUTC: 7, minuteUTC: 0 },
  internal.qualityMonitor.runQualityMonitorCheck,
  {}
)

export default crons

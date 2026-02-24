import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

/**
 * Cron Job Definitions
 *
 * Background scheduled tasks for the memory system.
 *
 * Schedule:
 *   - Memory extraction:   every 2 min  (LLM-based knowledge extraction)
 *   - Decay score update:  every 1 hour (Ebbinghaus decay recalculation)
 *   - Memory archival:     daily 8:00 UTC (archive decayed memories)
 *   - Memory compression:  daily 8:15 UTC (compress archived groups)
 *   - Memory cleanup:      weekly Sun 8:00 UTC (purge expired, hard-delete, orphan cleanup)
 *   - Lifecycle health:    every 6 hours (backlog/sanity checks)
 */

const crons = cronJobs()

crons.interval(
  'memory extraction pipeline',
  { minutes: 2 },
  internal.memoryExtraction.processExtractionBatch,
  {}
)

crons.interval('decay score update', { hours: 1 }, internal.memoryDecay.runDecayUpdate, {})

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
  { hours: 6 },
  internal.memoryArchival.lifecycleHealthCheck,
  {}
)

export default crons

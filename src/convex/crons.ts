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
 *   - Memory archival:     daily 8:00 UTC (archive decayed memories, compress groups)
 *   - Memory cleanup:      weekly Sun 8:00 UTC (purge expired, hard-delete, orphan cleanup)
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

crons.weekly(
  'memory cleanup',
  { dayOfWeek: 'sunday', hourUTC: 8, minuteUTC: 0 },
  internal.memoryArchival.purgeExpiredMemories,
  {}
)

export default crons

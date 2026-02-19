import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

/**
 * Cron Job Definitions
 *
 * Background scheduled tasks for the memory system.
 */

const crons = cronJobs()

/**
 * Memory Extraction Pipeline
 *
 * Processes unprocessed memoryEvents by extracting structured knowledge
 * from conversations using LLM analysis. Creates businessMemories,
 * agentMemories, and memoryRelations from conversation data.
 *
 * Runs every 2 minutes, processing up to 5 events per batch.
 * At most one run executes at a time (Convex guarantees this).
 */
crons.interval(
  'memory extraction pipeline',
  { minutes: 2 },
  internal.memoryExtraction.processExtractionBatch,
  {}
)

export default crons

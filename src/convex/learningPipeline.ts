import { v } from 'convex/values'
import { createFailureRecord, failureToMemoryContent } from '../lib/learning/failureLearning'
import {
  detectPatterns,
  type PatternEvent,
  patternToMemoryContent,
  shouldAutoLearn,
} from '../lib/learning/patternDetection'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { isCronDisabled } from './lib/cronGuard'
import { applyMemoryLayerPiiPolicy } from './memoryValidation'

/**
 * Learning Pipeline — Phase 11 Runtime Wiring
 *
 * Standalone cron-triggered actions that run pattern detection, failure
 * learning, and quality snapshot persistence across all organisations.
 *
 * These complement the inline hooks already present in memoryExtraction.ts
 * (per-conversation pattern detection) and agentRunner.ts (per-execution
 * failure learning). The cron-based approach catches patterns that span
 * multiple conversations and accumulates a full picture over time.
 */

const MAX_ORGS_PER_RUN = 50
const PATTERN_DETECTION_BATCH_SIZE = 100
const FAILURE_LEARNING_BATCH_SIZE = 50

// ---------------------------------------------------------------------------
// Internal queries
// ---------------------------------------------------------------------------

export const listActiveOrgIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const orgs = await ctx.db.query('organizations').take(MAX_ORGS_PER_RUN)
    return orgs.map((o) => o._id as string)
  },
})

export const getRecentConversationEvents = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    sinceMs: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('memoryEvents')
      .withIndex('by_org_type_processed_created', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('eventType', 'conversation_end')
          .eq('processed', true)
          .gte('createdAt', args.sinceMs)
      )
      .order('desc')
      .take(args.limit)
  },
})

export const getRecentToolFailureEvents = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    sinceMs: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('memoryEvents')
      .withIndex('by_org_type_processed_created', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('eventType', 'tool_failure')
          .eq('processed', true)
          .gte('createdAt', args.sinceMs)
      )
      .order('desc')
      .take(args.limit)
  },
})

export const getExistingPatterns = internalQuery({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('detectedPatterns')
      .withIndex('by_org_active', (q) =>
        q.eq('organizationId', args.organizationId).eq('isActive', true)
      )
      .take(50)
  },
})

export const getExistingFailureMemories = internalQuery({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('agentMemories')
      .withIndex('by_org_active', (q) =>
        q.eq('organizationId', args.organizationId).eq('isActive', true)
      )
      .filter((q) => q.eq(q.field('category'), 'failure'))
      .take(100)
  },
})

export const getRecentMessages = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    sinceMs: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('messages')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId).gte('createdAt', args.sinceMs)
      )
      .order('desc')
      .take(args.limit)
  },
})

export const getPreviousQualitySnapshot = internalQuery({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('qualitySnapshots')
      .withIndex('by_org_created', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')
      .first()
  },
})

// ---------------------------------------------------------------------------
// Internal mutations
// ---------------------------------------------------------------------------

export const upsertDetectedPattern = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    patternType: v.union(
      v.literal('time_preference'),
      v.literal('communication_style'),
      v.literal('decision_speed'),
      v.literal('price_sensitivity'),
      v.literal('channel_preference')
    ),
    description: v.string(),
    confidence: v.float64(),
    occurrenceCount: v.number(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    autoLearned: v.boolean(),
    evidence: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('detectedPatterns')
      .withIndex('by_org_type', (q) =>
        q.eq('organizationId', args.organizationId).eq('patternType', args.patternType)
      )
      .first()

    const now = Date.now()

    if (existing) {
      await ctx.db.patch(existing._id, {
        description: args.description,
        confidence: args.confidence,
        occurrenceCount: args.occurrenceCount,
        firstSeenAt: Math.min(existing.firstSeenAt, args.firstSeenAt),
        lastSeenAt: Math.max(existing.lastSeenAt, args.lastSeenAt),
        autoLearned: args.autoLearned || existing.autoLearned,
        evidence: args.evidence.slice(0, 5),
        updatedAt: now,
      })
      return { id: existing._id, updated: true }
    }

    const id = await ctx.db.insert('detectedPatterns', {
      organizationId: args.organizationId,
      patternType: args.patternType,
      description: args.description,
      confidence: args.confidence,
      occurrenceCount: args.occurrenceCount,
      firstSeenAt: args.firstSeenAt,
      lastSeenAt: args.lastSeenAt,
      autoLearned: args.autoLearned,
      evidence: args.evidence.slice(0, 5),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    return { id, updated: false }
  },
})

export const insertQualitySnapshot = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    overallScore: v.float64(),
    metrics: v.array(
      v.object({
        name: v.string(),
        value: v.float64(),
        previousValue: v.float64(),
        delta: v.float64(),
        timestamp: v.number(),
      })
    ),
    alerts: v.array(
      v.object({
        metric: v.string(),
        currentValue: v.float64(),
        previousValue: v.float64(),
        dropPercent: v.float64(),
        timestamp: v.number(),
      })
    ),
    alertTriggered: v.boolean(),
    alertReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('qualitySnapshots', {
      organizationId: args.organizationId,
      overallScore: args.overallScore,
      metrics: args.metrics,
      alerts: args.alerts,
      alertTriggered: args.alertTriggered,
      alertReason: args.alertReason,
      createdAt: Date.now(),
    })
  },
})

/**
 * Mutation callable from processExtractionBatch (action context) to schedule
 * learning pipeline runs after fresh events have been processed.
 * Uses ctx.scheduler so the actions run asynchronously after the mutation returns.
 */
export const scheduleLearningAfterExtraction = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.learningPipeline.runPatternDetectionBatch, {})
    await ctx.scheduler.runAfter(0, internal.learningPipeline.runFailureLearningBatch, {})
  },
})

// ---------------------------------------------------------------------------
// Pattern Detection Action (Phase 11.2)
// ---------------------------------------------------------------------------

export const runPatternDetectionBatch = internalAction({
  args: {},
  handler: async (ctx): Promise<{ orgsProcessed: number; patternsDetected: number }> => {
    if (isCronDisabled()) {
      return { orgsProcessed: 0, patternsDetected: 0 }
    }

    const orgIds: string[] = await ctx.runQuery(internal.learningPipeline.listActiveOrgIds, {})
    let orgsProcessed = 0
    let patternsDetected = 0

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

    for (const orgId of orgIds) {
      try {
        const recentMessages: Doc<'messages'>[] = await ctx.runQuery(
          internal.learningPipeline.getRecentMessages,
          {
            organizationId: orgId as Id<'organizations'>,
            sinceMs: thirtyDaysAgo,
            limit: PATTERN_DETECTION_BATCH_SIZE,
          }
        )

        const userMessages = recentMessages.filter((m) => m.role === 'user')
        if (userMessages.length < 5) continue

        const patternEvents: PatternEvent[] = userMessages.map((m) => ({
          type: 'user_message',
          content: m.content,
          timestamp: m.createdAt,
        }))

        const existingDbPatterns: Doc<'detectedPatterns'>[] = await ctx.runQuery(
          internal.learningPipeline.getExistingPatterns,
          { organizationId: orgId as Id<'organizations'> }
        )

        const existingForDetection = existingDbPatterns.map((p) => ({
          type: p.patternType,
          description: p.description,
          occurrences: p.occurrenceCount,
          confidence: p.confidence,
          firstSeen: p.firstSeenAt,
          lastSeen: p.lastSeenAt,
          autoLearned: p.autoLearned,
          evidence: p.evidence,
        }))

        const detectionResult = detectPatterns(patternEvents, existingForDetection)

        for (const pattern of detectionResult.patterns) {
          const patternType = pattern.type as
            | 'time_preference'
            | 'communication_style'
            | 'decision_speed'
            | 'price_sensitivity'
            | 'channel_preference'

          await ctx.runMutation(internal.learningPipeline.upsertDetectedPattern, {
            organizationId: orgId as Id<'organizations'>,
            patternType,
            description: pattern.description.slice(0, 500),
            confidence: pattern.confidence,
            occurrenceCount: pattern.occurrences,
            firstSeenAt: pattern.firstSeen,
            lastSeenAt: pattern.lastSeen,
            autoLearned: pattern.autoLearned,
            evidence: pattern.evidence.slice(0, 5),
          })

          patternsDetected++

          if (shouldAutoLearn(pattern)) {
            const memContent = patternToMemoryContent(pattern)
            const piiSafe = applyMemoryLayerPiiPolicy(memContent, 'agent').content
            try {
              const inserted = await ctx.runMutation(internal.memoryExtraction.insertAgentMemory, {
                organizationId: orgId as Id<'organizations'>,
                agentType: 'crm',
                category: 'pattern' as const,
                content: piiSafe.slice(0, 500),
                confidence: pattern.confidence,
              })
              await ctx.runAction(internal.embedding.generateAndStore, {
                tableName: 'agentMemories' as const,
                documentId: inserted.id,
                content: piiSafe.slice(0, 500),
                organizationId: orgId as Id<'organizations'>,
              })
            } catch {
              // Non-critical: individual pattern memory failures are swallowed.
            }
          }
        }

        orgsProcessed++
      } catch (error) {
        console.error('[LearningPipeline] Pattern detection failed for org:', {
          organizationId: orgId,
          error: error instanceof Error ? error.message : 'Unknown',
        })
      }
    }

    if (orgsProcessed > 0 || patternsDetected > 0) {
      console.log('[LearningPipeline] Pattern detection complete:', {
        orgsProcessed,
        patternsDetected,
      })
    }

    return { orgsProcessed, patternsDetected }
  },
})

// ---------------------------------------------------------------------------
// Failure Learning Action (Phase 11.3)
// ---------------------------------------------------------------------------

function mapToolToAgentType(toolName: string): string {
  const toolAgentMap: Record<string, string> = {
    createLead: 'crm',
    updateLead: 'crm',
    searchLeads: 'crm',
    createAppointment: 'crm',
    updateAppointment: 'crm',
    createInvoice: 'invoice',
    updateInvoice: 'invoice',
    sendFollowUp: 'followup',
    sendReminder: 'reminder',
  }
  return toolAgentMap[toolName] ?? 'crm'
}

export const runFailureLearningBatch = internalAction({
  args: {},
  handler: async (ctx): Promise<{ orgsProcessed: number; failuresRecorded: number }> => {
    if (isCronDisabled()) {
      return { orgsProcessed: 0, failuresRecorded: 0 }
    }

    const orgIds: string[] = await ctx.runQuery(internal.learningPipeline.listActiveOrgIds, {})
    let orgsProcessed = 0
    let failuresRecorded = 0

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

    for (const orgId of orgIds) {
      try {
        const failureEvents: Doc<'memoryEvents'>[] = await ctx.runQuery(
          internal.learningPipeline.getRecentToolFailureEvents,
          {
            organizationId: orgId as Id<'organizations'>,
            sinceMs: sevenDaysAgo,
            limit: FAILURE_LEARNING_BATCH_SIZE,
          }
        )

        if (failureEvents.length === 0) continue

        const existingFailures: Doc<'agentMemories'>[] = await ctx.runQuery(
          internal.learningPipeline.getExistingFailureMemories,
          { organizationId: orgId as Id<'organizations'> }
        )

        const existingContents = new Set(existingFailures.map((f) => f.content))

        for (const event of failureEvents) {
          const eventData = event.data as Record<string, any>
          const toolName = (eventData.toolName as string) ?? ''
          const errorStr = (eventData.error as string) ?? (eventData.result as string) ?? ''

          if (!errorStr || errorStr.length < 5) continue

          const agentType = mapToolToAgentType(toolName)
          const record = createFailureRecord(
            errorStr,
            `${toolName}: ${(eventData.args as string)?.slice(0, 100) ?? ''}`,
            agentType
          )
          if (!record) continue

          const memContent = failureToMemoryContent(record)
          if (existingContents.has(memContent)) continue

          const piiSafe = applyMemoryLayerPiiPolicy(memContent, 'agent').content

          try {
            const inserted = await ctx.runMutation(internal.memoryExtraction.insertAgentMemory, {
              organizationId: orgId as Id<'organizations'>,
              agentType,
              category: 'failure' as const,
              content: piiSafe.slice(0, 500),
              confidence: 0.65,
            })
            await ctx.runAction(internal.embedding.generateAndStore, {
              tableName: 'agentMemories' as const,
              documentId: inserted.id,
              content: piiSafe.slice(0, 500),
              organizationId: orgId as Id<'organizations'>,
            })

            existingContents.add(memContent)
            failuresRecorded++
          } catch {
            // Non-critical: individual failure record errors are swallowed.
          }
        }

        orgsProcessed++
      } catch (error) {
        console.error('[LearningPipeline] Failure learning failed for org:', {
          organizationId: orgId,
          error: error instanceof Error ? error.message : 'Unknown',
        })
      }
    }

    if (orgsProcessed > 0 || failuresRecorded > 0) {
      console.log('[LearningPipeline] Failure learning complete:', {
        orgsProcessed,
        failuresRecorded,
      })
    }

    return { orgsProcessed, failuresRecorded }
  },
})

import { v } from 'convex/values'
import { estimateCost } from '../lib/cost/pricing'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { isEmbeddingConfigured } from './embedding'
import { isCronDisabled } from './lib/cronGuard'
import { type ResolvedLLMProvider, resolveLLMProvider } from './llmProvider'

/**
 * Memory Extraction Pipeline
 *
 * Background worker that processes memoryEvents to extract structured
 * knowledge from conversations. Triggered by a cron job.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  EXTRACTION PIPELINE                                                │
 * │                                                                     │
 * │  Cron trigger (every 2 min)                                         │
 * │    ↓                                                                │
 * │  processExtractionBatch (internalAction)                            │
 * │    ├─ Fetch unprocessed events (FIFO, batch of 5)                   │
 * │    ├─ For each event:                                               │
 * │    │   ├─ Fetch conversation messages (internalQuery)               │
 * │    │   ├─ Fetch existing memories for dedup context                 │
 * │    │   ├─ Call LLM with extraction prompt                           │
 * │    │   ├─ Parse structured output                                   │
 * │    │   ├─ Dedup: vector similarity ≥ DEDUP_SIMILARITY_THRESHOLD     │
 * │    │   ├─ Create businessMemories (internalMutation)                │
 * │    │   ├─ Create agentMemories (internalMutation)                   │
 * │    │   ├─ Create memoryRelations (internalMutation)                 │
 * │    │   └─ markProcessed(eventId)                                    │
 * │    └─ Return summary                                                │
 * └─────────────────────────────────────────────────────────────────────┘
 */

const DEBUG = process.env.DEBUG_MEMORY === 'true'

const EXTRACTION_BATCH_SIZE = 5
const MAX_MESSAGES_FOR_EXTRACTION = 30
const DEDUP_SIMILARITY_THRESHOLD = 0.92
const DEDUP_SEARCH_LIMIT = 10
const MAX_LLM_RETRIES = 2
const MAX_EVENT_RETRIES = 3

/**
 * Normalize a subject name for use as `subjectId`.
 * Until entity resolution is implemented (Phase 8+), the LLM-extracted
 * display name is stored as the ID. Normalizing ensures consistent
 * matching across extractions (e.g. "Sarah Johnson" and "sarah johnson"
 * resolve to the same subject).
 */
function normalizeSubjectName(name: string | undefined): string | undefined {
  if (!name) return undefined
  return name.trim().toLowerCase()
}

// TTL defaults (mirrored from src/lib/memory/ttl.ts for Convex runtime)
const TTL_MS_PER_DAY = 86_400_000
const TTL_DAYS: Record<string, number | null> = {
  fact: 180,
  preference: 90,
  instruction: null,
  context: 30,
  relationship: 180,
  episodic: 90,
}
function computeTTLExpiresAt(type: string, createdAt: number): number | undefined {
  const days = TTL_DAYS[type]
  if (days === null || days === undefined) return undefined
  return createdAt + days * TTL_MS_PER_DAY
}

const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction engine for a CRM assistant called "Reme".
Analyze conversations between a business owner and the AI assistant, then extract structured knowledge for future interactions.

## Extract These Types

### businessMemories
- fact: Client details, business info, pricing
- preference: How clients or the business owner prefer things
- instruction: Explicit rules the owner has stated
- context: Situational background info
- relationship: Connections between people/services
- episodic: Recent interaction context

### agentMemories (from tool usage only)
- success: What worked well
- failure: What went wrong
- pattern: Recurring behaviors
- preference: Learned configuration

### relations
- Connections between entities (prefers, related_to, leads_to, requires, conflicts_with)

## Handling Corrections & Contradictions
When a user CORRECTS, UPDATES, or NEGATES previous information:
1. ALWAYS extract the UPDATED fact as a new businessMemory with confidence 1.0
2. ALSO include a "corrections" array identifying the old facts being superseded
3. The new memory content MUST be TEMPORAL-AWARE — include what changed:
   - Good: "Sarah Johnson prefers evening appointments after 5pm (previously preferred afternoons)"
   - Bad: "Sarah Johnson prefers evening appointments after 5pm" (loses the history)
4. This lets the AI naturally say "I know Sarah switched from afternoons to evenings"
5. Only add the temporal parenthetical when the old preference is known from "Already Known"

CRITICAL: You must ALWAYS produce BOTH a new businessMemory AND a corrections entry for any correction. Never produce corrections without a corresponding businessMemory.

## Rules
1. Extract ONLY information explicitly stated or strongly implied
2. Each memory must be self-contained — understandable without the conversation
3. Do NOT extract generic knowledge without specific context
4. Do NOT extract the AI's responses — only what the USER reveals
5. Prefer specific, named entities (ALWAYS use full names when known: "Sarah Johnson" not "Sarah")
6. Set importance: client preferences (0.8+), business rules (0.9+), one-time context (0.3-0.5)
7. Set confidence: 1.0 for explicit, 0.7-0.9 for inferred
8. Return empty arrays if no extractable knowledge
9. Avoid redundancy — check the "Already Known" list before extracting

Respond with valid JSON matching this exact structure:
{
  "businessMemories": [{ "type": "fact|preference|instruction|context|relationship|episodic", "content": "...", "importance": 0.0-1.0, "confidence": 0.5-1.0, "subjectType": "lead|service|appointment|invoice|general", "subjectName": "..." }],
  "agentMemories": [{ "agentType": "chat|crm|followup|invoice|sales|reminder", "category": "pattern|preference|success|failure", "content": "...", "confidence": 0.5-1.0 }],
  "relations": [{ "sourceType": "...", "sourceName": "...", "targetType": "...", "targetName": "...", "relationType": "prefers|related_to|leads_to|requires|conflicts_with", "strength": 0.0-1.0, "evidence": "..." }],
  "corrections": [{ "oldContent": "...", "reason": "..." }]
}`

interface ExtractionResult {
  businessMemories: Array<{
    type: string
    content: string
    importance: number
    confidence: number
    subjectType?: string
    subjectName?: string
  }>
  agentMemories: Array<{
    agentType: string
    category: string
    content: string
    confidence: number
  }>
  relations: Array<{
    sourceType: string
    sourceName: string
    targetType: string
    targetName: string
    relationType: string
    strength: number
    evidence: string
  }>
  corrections: Array<{
    oldContent: string
    reason: string
  }>
}

interface ExtractionLLMResult {
  extraction: ExtractionResult
  inputTokens: number
  outputTokens: number
  totalTokens: number
  latencyMs: number
  exactCostUsd?: number
}

async function callExtractionLLM(
  provider: ResolvedLLMProvider,
  conversationText: string,
  existingMemories: string[]
): Promise<ExtractionLLMResult> {
  let userPrompt = `## Conversation Transcript\n\n${conversationText}`

  if (existingMemories.length > 0) {
    userPrompt += '\n\n## Already Known (do NOT re-extract)\n'
    for (const mem of existingMemories) {
      userPrompt += `- ${mem}\n`
    }
  }

  userPrompt += '\nExtract all relevant memories from the conversation above. Return JSON only.'

  let lastError: Error | null = null
  const callStartMs = Date.now()

  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    const attemptStartMs = Date.now()
    try {
      const response = await fetch(provider.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        const error = new Error(
          `${provider.name} extraction API error (${response.status}): ${errorBody.slice(0, 200)}`
        )
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw error
        }
        lastError = error
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
        continue
      }

      const data = await response.json()
      const content = data.choices?.[0]?.message?.content
      if (!content) {
        throw new Error('Empty response from extraction LLM')
      }

      const usage = data.usage ?? {}
      const inputTokens = usage.prompt_tokens ?? 0
      const outputTokens = usage.completion_tokens ?? 0
      const latencyMs = Date.now() - attemptStartMs
      const rawCost = usage.total_cost ?? data.total_cost
      const exactCostUsd = typeof rawCost === 'number' && rawCost > 0 ? rawCost : undefined

      const parsed = JSON.parse(content) as ExtractionResult
      return {
        extraction: {
          businessMemories: Array.isArray(parsed.businessMemories) ? parsed.businessMemories : [],
          agentMemories: Array.isArray(parsed.agentMemories) ? parsed.agentMemories : [],
          relations: Array.isArray(parsed.relations) ? parsed.relations : [],
          corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
        },
        inputTokens,
        outputTokens,
        totalTokens: usage.total_tokens ?? inputTokens + outputTokens,
        latencyMs,
        exactCostUsd,
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.warn('[Extraction] LLM returned invalid JSON, retrying:', {
          attempt,
          provider: provider.name,
        })
      }
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < MAX_LLM_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
      }
    }
  }

  console.error('[Extraction] LLM call failed after retries:', {
    provider: provider.name,
    error: lastError?.message,
  })
  return {
    extraction: { businessMemories: [], agentMemories: [], relations: [], corrections: [] },
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    latencyMs: Date.now() - callStartMs,
  }
}

interface ToolSummaryUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  latencyMs: number
  exactCostUsd?: number
}

async function summarizeToolOutcome(
  provider: ResolvedLLMProvider,
  toolName: string,
  isSuccess: boolean,
  argsStr: string,
  resultStr: string
): Promise<{ summary: string; usage?: ToolSummaryUsage }> {
  const fallback = isSuccess
    ? `Tool "${toolName}" succeeded: ${argsStr.slice(0, 100)}`
    : `Tool "${toolName}" failed: ${resultStr.slice(0, 100)}`
  const startMs = Date.now()

  try {
    const response = await fetch(provider.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          {
            role: 'system',
            content:
              'Summarize this tool outcome into a concise, reusable pattern. Reply with just the pattern statement, no extra text. Max 200 chars.',
          },
          {
            role: 'user',
            content: `Tool: ${toolName}, ${isSuccess ? 'Success' : 'Failure'}, Args: ${argsStr.slice(0, 300)}, Result: ${resultStr.slice(0, 300)}`,
          },
        ],
        temperature: 0,
        max_tokens: 100,
      }),
    })

    if (response.ok) {
      const data = await response.json()
      const content = data.choices?.[0]?.message?.content?.trim()
      const usage = data.usage ?? {}
      const inputTokens = usage.prompt_tokens ?? 0
      const outputTokens = usage.completion_tokens ?? 0
      const totalTokens = usage.total_tokens ?? inputTokens + outputTokens
      const rawCost = usage.total_cost ?? data.total_cost
      const exactCostUsd = typeof rawCost === 'number' && rawCost > 0 ? rawCost : undefined
      const usageData: ToolSummaryUsage | undefined =
        totalTokens > 0
          ? {
              inputTokens,
              outputTokens,
              totalTokens,
              latencyMs: Date.now() - startMs,
              exactCostUsd,
            }
          : undefined
      if (content && content.length >= 10 && content.length <= 500) {
        return { summary: content, usage: usageData }
      }
    }
  } catch {
    // Use fallback
  }

  return { summary: fallback.slice(0, 500) }
}

export const getConversationMessages = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    conversationId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? MAX_MESSAGES_FOR_EXTRACTION, 100)
    return await ctx.db
      .query('messages')
      .withIndex('by_org_conversation', (q) =>
        q.eq('organizationId', args.organizationId).eq('conversationId', args.conversationId)
      )
      .order('asc')
      .take(pageSize)
  },
})

export const getExistingMemoryContents = internalQuery({
  args: {
    organizationId: v.id('organizations'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? 50, 200)
    const memories = await ctx.db
      .query('businessMemories')
      .withIndex('by_org_active', (q) =>
        q.eq('organizationId', args.organizationId).eq('isActive', true)
      )
      .order('desc')
      .take(pageSize)
    return memories.map((m) => m.content)
  },
})

export const getNextUnprocessedBatch = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit ?? EXTRACTION_BATCH_SIZE, 50)
    return await ctx.db
      .query('memoryEvents')
      .withIndex('by_created')
      .order('asc')
      .filter((q) => q.and(q.eq(q.field('processed'), false), q.eq(q.field('status'), 'pending')))
      .take(pageSize)
  },
})

const VALID_BUSINESS_TYPES = new Set([
  'fact',
  'preference',
  'instruction',
  'context',
  'relationship',
  'episodic',
])
const VALID_AGENT_CATEGORIES = new Set(['pattern', 'preference', 'success', 'failure'])
const VALID_AGENT_TYPES = new Set(['chat', 'crm', 'followup', 'invoice', 'sales', 'reminder'])
const VALID_RELATION_TYPES = new Set([
  'prefers',
  'related_to',
  'leads_to',
  'requires',
  'conflicts_with',
])

function isValidBusinessMemory(m: ExtractionResult['businessMemories'][0]): boolean {
  return (
    VALID_BUSINESS_TYPES.has(m.type) &&
    typeof m.content === 'string' &&
    m.content.length >= 10 &&
    m.content.length <= 500 &&
    typeof m.importance === 'number' &&
    m.importance >= 0 &&
    m.importance <= 1 &&
    typeof m.confidence === 'number' &&
    m.confidence >= 0.5 &&
    m.confidence <= 1
  )
}

function isValidAgentMemory(m: ExtractionResult['agentMemories'][0]): boolean {
  return (
    VALID_AGENT_TYPES.has(m.agentType) &&
    VALID_AGENT_CATEGORIES.has(m.category) &&
    typeof m.content === 'string' &&
    m.content.length >= 10 &&
    m.content.length <= 500 &&
    typeof m.confidence === 'number' &&
    m.confidence >= 0.5 &&
    m.confidence <= 1
  )
}

function isValidRelation(r: ExtractionResult['relations'][0]): boolean {
  return (
    typeof r.sourceType === 'string' &&
    typeof r.sourceName === 'string' &&
    typeof r.targetType === 'string' &&
    typeof r.targetName === 'string' &&
    VALID_RELATION_TYPES.has(r.relationType) &&
    typeof r.strength === 'number' &&
    r.strength >= 0 &&
    r.strength <= 1 &&
    typeof r.evidence === 'string'
  )
}

function formatConversation(messages: Doc<'messages'>[]): string {
  const parts: string[] = []
  for (const msg of messages) {
    const role = msg.role === 'user' ? 'USER' : 'ASSISTANT'
    parts.push(`**${role}:** ${msg.content}`)

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        parts.push(`  [Tool: ${tc.name}] Args: ${tc.args}`)
        if (tc.result) {
          parts.push(`  [Result] ${tc.result.slice(0, 300)}`)
        }
      }
    }
  }
  return parts.join('\n')
}

async function isDuplicate(
  ctx: { runAction: (...args: any[]) => Promise<any> },
  content: string,
  organizationId: Id<'organizations'>
): Promise<{ isDup: boolean; existingId?: Id<'businessMemories'>; existingConfidence?: number }> {
  if (!isEmbeddingConfigured()) {
    return { isDup: false }
  }

  try {
    const embedding: number[] = await ctx.runAction(internal.embedding.generateEmbedding, {
      text: content,
    })

    const results: Array<{ document: Doc<'businessMemories'>; score: number }> =
      await ctx.runAction(internal.vectorSearch.searchBusinessMemories, {
        embedding,
        organizationId,
        limit: DEDUP_SEARCH_LIMIT,
      })

    for (const result of results) {
      if (result.score >= DEDUP_SIMILARITY_THRESHOLD) {
        return {
          isDup: true,
          existingId: result.document._id,
          existingConfidence: result.document.confidence,
        }
      }
    }
  } catch (error) {
    console.warn('[Extraction] Dedup check failed, proceeding with creation:', {
      organizationId,
      error: error instanceof Error ? error.message : 'Unknown',
    })
  }

  return { isDup: false }
}

function mapToolToAgentType(toolName: string): string {
  const mapping: Record<string, string> = {
    addLead: 'crm',
    updateLead: 'crm',
    listLeads: 'crm',
    scheduleAppointment: 'crm',
    getSchedule: 'crm',
    createInvoice: 'invoice',
  }
  return mapping[toolName] ?? 'chat'
}

export const insertBusinessMemory = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    type: v.union(
      v.literal('fact'),
      v.literal('preference'),
      v.literal('instruction'),
      v.literal('context'),
      v.literal('relationship'),
      v.literal('episodic')
    ),
    content: v.string(),
    importance: v.float64(),
    confidence: v.float64(),
    subjectType: v.optional(v.string()),
    subjectId: v.optional(v.string()),
    source: v.union(
      v.literal('extraction'),
      v.literal('explicit'),
      v.literal('tool'),
      v.literal('system')
    ),
    sourceMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    return await ctx.db.insert('businessMemories', {
      organizationId: args.organizationId,
      type: args.type,
      content: args.content,
      importance: args.importance,
      confidence: args.confidence,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      source: args.source,
      sourceMessageId: args.sourceMessageId,
      expiresAt: computeTTLExpiresAt(args.type, now),
      decayScore: 1.0,
      accessCount: 0,
      lastAccessedAt: now,
      isActive: true,
      isArchived: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const updateBusinessMemoryVersion = internalMutation({
  args: {
    id: v.id('businessMemories'),
    organizationId: v.id('organizations'),
    content: v.string(),
    confidence: v.float64(),
    importance: v.float64(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing || existing.organizationId !== args.organizationId) {
      throw new Error('Business memory not found or access denied')
    }

    const now = Date.now()
    const newId = await ctx.db.insert('businessMemories', {
      organizationId: args.organizationId,
      type: existing.type,
      content: args.content,
      importance: args.importance,
      confidence: args.confidence,
      subjectType: existing.subjectType,
      subjectId: existing.subjectId,
      source: 'extraction',
      sourceMessageId: existing.sourceMessageId,
      expiresAt: computeTTLExpiresAt(existing.type, now),
      decayScore: 1.0,
      accessCount: 0,
      lastAccessedAt: now,
      isActive: true,
      isArchived: false,
      version: existing.version + 1,
      previousVersionId: args.id,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.patch(args.id, {
      isActive: false,
      updatedAt: now,
    })

    return newId
  },
})

/**
 * Create a new memory version that supersedes an old one due to a user correction.
 * Preserves history: the old content is recorded in the `history` array,
 * and the old memory is deactivated via the version chain.
 */
export const supersedeBusinessMemory = internalMutation({
  args: {
    oldId: v.id('businessMemories'),
    organizationId: v.id('organizations'),
    content: v.string(),
    confidence: v.float64(),
    importance: v.float64(),
    subjectType: v.optional(v.string()),
    subjectId: v.optional(v.string()),
    reason: v.optional(v.string()),
    source: v.union(
      v.literal('extraction'),
      v.literal('explicit'),
      v.literal('tool'),
      v.literal('system')
    ),
    sourceMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.oldId)
    if (!existing || existing.organizationId !== args.organizationId) {
      throw new Error('Business memory not found or access denied')
    }

    const now = Date.now()
    const existingHistory = existing.history ?? []
    const newHistory = [
      ...existingHistory,
      {
        previousContent: existing.content,
        changedAt: now,
        reason: args.reason,
      },
    ]

    const newId = await ctx.db.insert('businessMemories', {
      organizationId: args.organizationId,
      type: existing.type,
      content: args.content,
      importance: args.importance,
      confidence: args.confidence,
      subjectType: args.subjectType ?? existing.subjectType,
      subjectId: args.subjectId ?? existing.subjectId,
      source: args.source,
      sourceMessageId: args.sourceMessageId ?? existing.sourceMessageId,
      expiresAt: computeTTLExpiresAt(existing.type, now),
      decayScore: 1.0,
      accessCount: existing.accessCount,
      lastAccessedAt: now,
      isActive: true,
      isArchived: false,
      version: existing.version + 1,
      previousVersionId: args.oldId,
      history: newHistory,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.patch(args.oldId, {
      isActive: false,
      isArchived: true,
      updatedAt: now,
    })

    return newId
  },
})

export const insertAgentMemory = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    agentType: v.string(),
    category: v.union(
      v.literal('pattern'),
      v.literal('preference'),
      v.literal('success'),
      v.literal('failure')
    ),
    content: v.string(),
    confidence: v.float64(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    return await ctx.db.insert('agentMemories', {
      organizationId: args.organizationId,
      agentType: args.agentType,
      category: args.category,
      content: args.content,
      confidence: args.confidence,
      useCount: 0,
      successRate: 0.0,
      decayScore: 1.0,
      lastUsedAt: now,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const insertRelation = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    sourceType: v.string(),
    sourceId: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    relationType: v.union(
      v.literal('prefers'),
      v.literal('related_to'),
      v.literal('leads_to'),
      v.literal('requires'),
      v.literal('conflicts_with')
    ),
    strength: v.float64(),
    evidence: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    return await ctx.db.insert('memoryRelations', {
      organizationId: args.organizationId,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      targetType: args.targetType,
      targetId: args.targetId,
      relationType: args.relationType,
      strength: args.strength,
      evidence: args.evidence,
      createdAt: now,
      updatedAt: now,
    })
  },
})

interface CorrectionMatch {
  memoryId: Id<'businessMemories'>
  oldContent: string
  reason: string
}

async function processCorrections(
  ctx: {
    runAction: (...args: any[]) => Promise<any>
    runMutation: (...args: any[]) => Promise<any>
  },
  organizationId: Id<'organizations'>,
  corrections: ExtractionResult['corrections']
): Promise<{ superseded: number; matches: CorrectionMatch[] }> {
  const matches: CorrectionMatch[] = []

  for (const correction of corrections) {
    if (!correction.oldContent || correction.oldContent.length < 5) continue

    try {
      const embedding: number[] = await ctx.runAction(internal.embedding.generateEmbedding, {
        text: correction.oldContent,
      })

      const results: Array<{ document: Doc<'businessMemories'>; score: number }> =
        await ctx.runAction(internal.vectorSearch.searchBusinessMemories, {
          embedding,
          organizationId,
          limit: 3,
        })

      const best = results.find((r) => r.score >= 0.8)
      if (best) {
        matches.push({
          memoryId: best.document._id,
          oldContent: best.document.content,
          reason: correction.reason,
        })
        if (DEBUG) {
          console.log('[Extraction] Found memory to supersede:', {
            organizationId: String(organizationId),
            oldContent: best.document.content.slice(0, 80),
            score: best.score.toFixed(3),
            reason: correction.reason,
          })
        }
      }
    } catch (error) {
      console.warn('[Extraction] Failed to find correction target:', {
        organizationId: String(organizationId),
        error: error instanceof Error ? error.message : 'Unknown',
      })
    }
  }

  return { superseded: matches.length, matches }
}

async function createExtractedMemories(
  ctx: {
    runAction: (...args: any[]) => Promise<any>
    runMutation: (...args: any[]) => Promise<any>
  },
  organizationId: Id<'organizations'>,
  extraction: ExtractionResult,
  sourceId: string
): Promise<{ memoriesCreated: number; relationsCreated: number }> {
  let memoriesCreated = 0
  let relationsCreated = 0

  let correctionMatches: CorrectionMatch[] = []
  if (extraction.corrections.length > 0) {
    const result = await processCorrections(ctx, organizationId, extraction.corrections)
    correctionMatches = result.matches
    if (DEBUG && result.superseded > 0) {
      console.log('[Extraction] Found corrections to apply:', {
        organizationId: String(organizationId),
        correctionsRequested: extraction.corrections.length,
        matchesFound: result.superseded,
      })
    }
  }

  for (const mem of extraction.businessMemories) {
    if (!isValidBusinessMemory(mem)) continue

    const correctionForThisMem = correctionMatches.find((c) => {
      const memLower = mem.content.toLowerCase()
      const oldLower = c.oldContent.toLowerCase()
      const subjectWords = oldLower
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 3)
      return subjectWords.some((w) => memLower.includes(w))
    })

    if (correctionForThisMem) {
      try {
        const newId = await ctx.runMutation(internal.memoryExtraction.supersedeBusinessMemory, {
          oldId: correctionForThisMem.memoryId,
          organizationId,
          content: mem.content,
          confidence: mem.confidence,
          importance: mem.importance,
          subjectType: mem.subjectType,
          subjectId: normalizeSubjectName(mem.subjectName),
          reason: correctionForThisMem.reason,
          source: 'extraction' as const,
          sourceMessageId: sourceId,
        })

        await ctx.runAction(internal.embedding.generateAndStore, {
          tableName: 'businessMemories' as const,
          documentId: newId,
          content: mem.content,
          organizationId,
        })

        correctionMatches = correctionMatches.filter((c) => c !== correctionForThisMem)
        memoriesCreated++
        if (DEBUG) {
          console.log('[Extraction] Created temporal memory (superseded old):', {
            organizationId: String(organizationId),
            newContent: mem.content.slice(0, 100),
            oldContent: correctionForThisMem.oldContent.slice(0, 80),
          })
        }
      } catch (error) {
        console.warn('[Extraction] Failed to create temporal memory:', {
          organizationId: String(organizationId),
          error: error instanceof Error ? error.message : 'Unknown',
        })
      }
      continue
    }

    const dedup = await isDuplicate(ctx, mem.content, organizationId)

    if (dedup.isDup) {
      if (
        dedup.existingId &&
        dedup.existingConfidence !== undefined &&
        mem.confidence > dedup.existingConfidence
      ) {
        try {
          const newId = await ctx.runMutation(
            internal.memoryExtraction.updateBusinessMemoryVersion,
            {
              id: dedup.existingId,
              organizationId,
              content: mem.content,
              confidence: mem.confidence,
              importance: mem.importance,
            }
          )

          await ctx.runAction(internal.embedding.generateAndStore, {
            tableName: 'businessMemories' as const,
            documentId: newId,
            content: mem.content,
            organizationId,
          })

          memoriesCreated++
        } catch (error) {
          console.warn('[Extraction] Failed to update existing memory:', {
            organizationId: String(organizationId),
            existingId: dedup.existingId,
            error: error instanceof Error ? error.message : 'Unknown',
          })
        }
      }
      continue
    }

    try {
      const id = await ctx.runMutation(internal.memoryExtraction.insertBusinessMemory, {
        organizationId,
        type: mem.type as
          | 'fact'
          | 'preference'
          | 'instruction'
          | 'context'
          | 'relationship'
          | 'episodic',
        content: mem.content,
        importance: mem.importance,
        confidence: mem.confidence,
        subjectType: mem.subjectType,
        subjectId: normalizeSubjectName(mem.subjectName),
        source: 'extraction' as const,
        sourceMessageId: sourceId,
      })

      await ctx.runAction(internal.embedding.generateAndStore, {
        tableName: 'businessMemories' as const,
        documentId: id,
        content: mem.content,
        organizationId,
      })

      memoriesCreated++
    } catch (error) {
      console.warn('[Extraction] Failed to create business memory:', {
        organizationId: String(organizationId),
        type: mem.type,
        error: error instanceof Error ? error.message : 'Unknown',
      })
    }
  }

  if (correctionMatches.length > 0) {
    for (const orphan of correctionMatches) {
      try {
        await ctx.runMutation(internal.memoryExtraction.archiveBusinessMemory, {
          id: orphan.memoryId,
          organizationId,
        })
        if (DEBUG) {
          console.log('[Extraction] Archived memory (no replacement extracted):', {
            organizationId: String(organizationId),
            archivedContent: orphan.oldContent.slice(0, 80),
            reason: orphan.reason,
          })
        }
      } catch (error) {
        console.warn('[Extraction] Failed to archive orphan correction:', {
          organizationId: String(organizationId),
          error: error instanceof Error ? error.message : 'Unknown',
        })
      }
    }
  }

  for (const mem of extraction.agentMemories) {
    if (!isValidAgentMemory(mem)) continue

    try {
      const id = await ctx.runMutation(internal.memoryExtraction.insertAgentMemory, {
        organizationId,
        agentType: mem.agentType,
        category: mem.category as 'pattern' | 'preference' | 'success' | 'failure',
        content: mem.content,
        confidence: mem.confidence,
      })

      await ctx.runAction(internal.embedding.generateAndStore, {
        tableName: 'agentMemories' as const,
        documentId: id,
        content: mem.content,
        organizationId,
      })

      memoriesCreated++
    } catch (error) {
      console.warn('[Extraction] Failed to create agent memory:', {
        organizationId: String(organizationId),
        agentType: mem.agentType,
        category: mem.category,
        error: error instanceof Error ? error.message : 'Unknown',
      })
    }
  }

  for (const rel of extraction.relations) {
    if (!isValidRelation(rel)) continue

    try {
      await ctx.runMutation(internal.memoryExtraction.insertRelation, {
        organizationId,
        sourceType: rel.sourceType,
        sourceId: normalizeSubjectName(rel.sourceName) ?? rel.sourceName,
        targetType: rel.targetType,
        targetId: normalizeSubjectName(rel.targetName) ?? rel.targetName,
        relationType: rel.relationType as
          | 'prefers'
          | 'related_to'
          | 'leads_to'
          | 'requires'
          | 'conflicts_with',
        strength: rel.strength,
        evidence: rel.evidence.slice(0, 200),
      })
      relationsCreated++
    } catch (error) {
      console.warn('[Extraction] Failed to create relation:', {
        organizationId: String(organizationId),
        relationType: rel.relationType,
        error: error instanceof Error ? error.message : 'Unknown',
      })
    }
  }

  return { memoriesCreated, relationsCreated }
}

async function processConversationEnd(
  ctx: {
    runQuery: (...args: any[]) => Promise<any>
    runAction: (...args: any[]) => Promise<any>
    runMutation: (...args: any[]) => Promise<any>
  },
  event: Doc<'memoryEvents'>,
  provider: ResolvedLLMProvider
): Promise<{ memoriesCreated: number; relationsCreated: number }> {
  const eventData = event.data as Record<string, any>
  const conversationId = eventData.conversationId as string
  if (!conversationId) {
    return { memoriesCreated: 0, relationsCreated: 0 }
  }

  const [messages, existingMemories] = await Promise.all([
    ctx.runQuery(internal.memoryExtraction.getConversationMessages, {
      organizationId: event.organizationId,
      conversationId,
      limit: MAX_MESSAGES_FOR_EXTRACTION,
    }),
    ctx.runQuery(internal.memoryExtraction.getExistingMemoryContents, {
      organizationId: event.organizationId,
      limit: 50,
    }),
  ])

  if (messages.length < 2) {
    console.warn('[Extraction] Skipping event: too few messages', {
      organizationId: String(event.organizationId),
      conversationId,
      messageCount: messages.length,
      eventId: event._id,
    })
    return { memoriesCreated: 0, relationsCreated: 0 }
  }

  const conversationText = formatConversation(messages)
  const llmResult = await callExtractionLLM(provider, conversationText, existingMemories)
  if (llmResult.totalTokens > 0) {
    try {
      await ctx.runMutation(internal.llmUsage.record, {
        organizationId: event.organizationId,
        traceId: conversationId,
        model: provider.model,
        provider: provider.providerId,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        totalTokens: llmResult.totalTokens,
        estimatedCostUsd:
          llmResult.exactCostUsd ??
          estimateCost(provider.model, llmResult.inputTokens, llmResult.outputTokens),
        purpose: 'extraction' as const,
        cached: false,
        latencyMs: llmResult.latencyMs,
      })
    } catch {
      // Non-critical: swallow usage recording failures.
    }
  }

  return createExtractedMemories(ctx, event.organizationId, llmResult.extraction, event.sourceId)
}

async function processToolOutcome(
  ctx: {
    runAction: (...args: any[]) => Promise<any>
    runMutation: (...args: any[]) => Promise<any>
  },
  event: Doc<'memoryEvents'>,
  provider: ResolvedLLMProvider
): Promise<{ memoriesCreated: number; relationsCreated: number }> {
  const eventData = event.data as Record<string, any>
  const toolName = eventData.toolName as string
  if (!toolName) {
    return { memoriesCreated: 0, relationsCreated: 0 }
  }

  const isSuccess = event.eventType === 'tool_success'
  const category = isSuccess ? 'success' : 'failure'
  const agentType = mapToolToAgentType(toolName)
  const argsStr = (eventData.args as string) ?? ''
  const resultStr = (eventData.result as string) ?? (eventData.error as string) ?? ''

  const summaryResult = await summarizeToolOutcome(
    provider,
    toolName,
    isSuccess,
    argsStr,
    resultStr
  )
  const summary = summaryResult.summary

  if (summary.length < 10) {
    return { memoriesCreated: 0, relationsCreated: 0 }
  }

  if (summaryResult.usage && summaryResult.usage.totalTokens > 0) {
    try {
      await ctx.runMutation(internal.llmUsage.record, {
        organizationId: event.organizationId,
        traceId: event.sourceId,
        model: provider.model,
        provider: provider.providerId,
        inputTokens: summaryResult.usage.inputTokens,
        outputTokens: summaryResult.usage.outputTokens,
        totalTokens: summaryResult.usage.totalTokens,
        estimatedCostUsd:
          summaryResult.usage.exactCostUsd ??
          estimateCost(
            provider.model,
            summaryResult.usage.inputTokens,
            summaryResult.usage.outputTokens
          ),
        purpose: 'summary' as const,
        cached: false,
        latencyMs: summaryResult.usage.latencyMs,
      })
    } catch {
      // Non-critical: swallow usage recording failures.
    }
  }

  try {
    const id = await ctx.runMutation(internal.memoryExtraction.insertAgentMemory, {
      organizationId: event.organizationId,
      agentType,
      category: category as 'pattern' | 'preference' | 'success' | 'failure',
      content: summary.slice(0, 500),
      confidence: isSuccess ? 0.8 : 0.7,
    })

    await ctx.runAction(internal.embedding.generateAndStore, {
      tableName: 'agentMemories' as const,
      documentId: id,
      content: summary.slice(0, 500),
      organizationId: event.organizationId,
    })

    return { memoriesCreated: 1, relationsCreated: 0 }
  } catch (error) {
    console.error('[Extraction] Failed to create agent memory from tool outcome:', {
      organizationId: String(event.organizationId),
      eventId: event._id,
      toolName,
      error: error instanceof Error ? error.message : 'Unknown',
    })
    return { memoriesCreated: 0, relationsCreated: 0 }
  }
}

/**
 * Process a `user_correction` event through the full supersede pipeline.
 *
 * When the event carries `originalContent` (the old fact the user is correcting),
 * we embed it and search for the matching memory. If a high-confidence match is
 * found (score ≥ 0.8) we supersede it so history is preserved and the stale
 * memory is deactivated. If no match is found we fall back to inserting the new
 * content as a standalone `preference` memory so no information is lost.
 */
async function processUserCorrectionEvent(
  ctx: {
    runMutation: (...args: any[]) => Promise<any>
    runAction: (...args: any[]) => Promise<any>
  },
  event: Doc<'memoryEvents'>
): Promise<{ memoriesCreated: number; relationsCreated: number }> {
  const eventData = event.data as Record<string, any>
  const newContent = (eventData.content as string | undefined)?.trim()
  const originalContent = (eventData.originalContent as string | undefined)?.trim()

  if (!newContent || newContent.length < 10 || newContent.length > 500) {
    return { memoriesCreated: 0, relationsCreated: 0 }
  }

  try {
    // Attempt to find and supersede the old memory when the original is known.
    if (originalContent && originalContent.length >= 5) {
      const embedding: number[] = await ctx.runAction(internal.embedding.generateEmbedding, {
        text: originalContent,
      })

      const results: Array<{ document: Doc<'businessMemories'>; score: number }> =
        await ctx.runAction(internal.vectorSearch.searchBusinessMemories, {
          embedding,
          organizationId: event.organizationId,
          limit: 3,
        })

      const best = results.find((r) => r.score >= 0.8)
      if (best) {
        const newId = await ctx.runMutation(internal.memoryExtraction.supersedeBusinessMemory, {
          oldId: best.document._id,
          organizationId: event.organizationId,
          content: newContent.slice(0, 500),
          importance: 0.9,
          confidence: 1.0,
          source: 'explicit' as const,
          sourceMessageId: event.sourceId,
          reason: 'Superseded by explicit user correction',
        })
        await ctx.runAction(internal.embedding.generateAndStore, {
          tableName: 'businessMemories' as const,
          documentId: newId,
          content: newContent.slice(0, 500),
          organizationId: event.organizationId,
        })
        return { memoriesCreated: 1, relationsCreated: 0 }
      }
    }

    // Fallback: no matching memory found — insert as a new preference memory.
    const id = await ctx.runMutation(internal.memoryExtraction.insertBusinessMemory, {
      organizationId: event.organizationId,
      type: 'preference' as const,
      content: newContent.slice(0, 500),
      importance: 0.9,
      confidence: 1.0,
      source: 'explicit' as const,
      sourceMessageId: event.sourceId,
    })
    await ctx.runAction(internal.embedding.generateAndStore, {
      tableName: 'businessMemories' as const,
      documentId: id,
      content: newContent.slice(0, 500),
      organizationId: event.organizationId,
    })
    return { memoriesCreated: 1, relationsCreated: 0 }
  } catch (error) {
    console.error('[Extraction] Failed to process user correction event:', {
      organizationId: String(event.organizationId),
      eventId: event._id,
      error: error instanceof Error ? error.message : 'Unknown',
    })
    return { memoriesCreated: 0, relationsCreated: 0 }
  }
}

async function processUserInputEvent(
  ctx: {
    runMutation: (...args: any[]) => Promise<any>
    runAction: (...args: any[]) => Promise<any>
  },
  event: Doc<'memoryEvents'>,
  memoryType: 'instruction' | 'context',
  importance: number,
  confidence: number
): Promise<{ memoriesCreated: number; relationsCreated: number }> {
  const eventData = event.data as Record<string, any>
  const content = (eventData.content as string | undefined)?.trim()
  if (!content || content.length < 10 || content.length > 500) {
    return { memoriesCreated: 0, relationsCreated: 0 }
  }

  try {
    const id = await ctx.runMutation(internal.memoryExtraction.insertBusinessMemory, {
      organizationId: event.organizationId,
      type: memoryType,
      content: content.slice(0, 500),
      importance,
      confidence,
      source: 'explicit' as const,
      sourceMessageId: event.sourceId,
    })

    await ctx.runAction(internal.embedding.generateAndStore, {
      tableName: 'businessMemories' as const,
      documentId: id,
      content: content.slice(0, 500),
      organizationId: event.organizationId,
    })

    return { memoriesCreated: 1, relationsCreated: 0 }
  } catch (error) {
    console.error('[Extraction] Failed to process user input event:', {
      organizationId: String(event.organizationId),
      eventId: event._id,
      eventType: event.eventType,
      error: error instanceof Error ? error.message : 'Unknown',
    })
    return { memoriesCreated: 0, relationsCreated: 0 }
  }
}

async function processFeedbackOrApprovalEvent(
  ctx: {
    runMutation: (...args: any[]) => Promise<any>
    runAction: (...args: any[]) => Promise<any>
  },
  event: Doc<'memoryEvents'>
): Promise<{ memoriesCreated: number; relationsCreated: number }> {
  const eventData = event.data as Record<string, any>

  let content = ''
  let confidence = 0.75

  if (event.eventType === 'feedback') {
    const rating = typeof eventData.rating === 'number' ? eventData.rating : undefined
    const comment = typeof eventData.comment === 'string' ? eventData.comment : ''
    content = rating
      ? `User feedback received (rating: ${rating}${comment ? `, comment: ${comment}` : ''})`
      : `User feedback received${comment ? `: ${comment}` : ''}`
    confidence = 0.7
  } else {
    const approved = event.eventType === 'approval_granted'
    const actionDescription = (eventData.actionDescription as string | undefined) ?? 'agent action'
    const reason = (eventData.reason as string | undefined) ?? ''
    content = approved
      ? `Approval granted for ${actionDescription}${reason ? ` (${reason})` : ''}`
      : `Approval rejected for ${actionDescription}${reason ? ` (${reason})` : ''}`
    confidence = 0.85
  }

  const normalized = content.trim().slice(0, 500)
  if (normalized.length < 10) {
    return { memoriesCreated: 0, relationsCreated: 0 }
  }

  try {
    const id = await ctx.runMutation(internal.memoryExtraction.insertAgentMemory, {
      organizationId: event.organizationId,
      agentType: 'chat',
      category: event.eventType === 'approval_rejected' ? 'failure' : 'pattern',
      content: normalized,
      confidence,
    })

    await ctx.runAction(internal.embedding.generateAndStore, {
      tableName: 'agentMemories' as const,
      documentId: id,
      content: normalized,
      organizationId: event.organizationId,
    })

    return { memoriesCreated: 1, relationsCreated: 0 }
  } catch (error) {
    console.error('[Extraction] Failed to process feedback/approval event:', {
      organizationId: String(event.organizationId),
      eventId: event._id,
      eventType: event.eventType,
      error: error instanceof Error ? error.message : 'Unknown',
    })
    return { memoriesCreated: 0, relationsCreated: 0 }
  }
}

export const processExtractionBatch = internalAction({
  args: {
    organizationId: v.optional(v.id('organizations')),
    batchSize: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    processed: number
    memoriesCreated: number
    relationsCreated: number
    errors: number
  }> => {
    if (isCronDisabled()) {
      return { processed: 0, memoriesCreated: 0, relationsCreated: 0, errors: 0 }
    }

    const batchSize = Math.min(args.batchSize ?? EXTRACTION_BATCH_SIZE, 20)

    let events: Doc<'memoryEvents'>[]

    if (args.organizationId) {
      events = await ctx.runQuery(internal.memoryEvents.listUnprocessedInternal, {
        organizationId: args.organizationId,
        limit: batchSize,
      })
    } else {
      events = await ctx.runQuery(internal.memoryExtraction.getNextUnprocessedBatch, {
        limit: batchSize,
      })
    }

    if (events.length === 0) {
      return { processed: 0, memoriesCreated: 0, relationsCreated: 0, errors: 0 }
    }

    const batchStartMs = Date.now()
    const batchId = `${batchStartMs}-${Math.random().toString(36).slice(2, 8)}`
    let totalProcessed = 0
    let totalMemoriesCreated = 0
    let totalRelationsCreated = 0
    let totalErrors = 0

    const provider = resolveLLMProvider()

    for (const event of events) {
      const lockResult = await ctx.runMutation(internal.memoryEvents.markProcessing, {
        id: event._id,
        organizationId: event.organizationId,
      })
      if (!lockResult.success) {
        continue
      }

      try {
        let result = { memoriesCreated: 0, relationsCreated: 0 }

        if (event.eventType === 'conversation_end') {
          result = await processConversationEnd(ctx, event, provider)
        } else if (event.eventType === 'tool_success' || event.eventType === 'tool_failure') {
          result = await processToolOutcome(ctx, event, provider)
        } else if (event.eventType === 'user_correction') {
          result = await processUserCorrectionEvent(ctx, event)
        } else if (event.eventType === 'explicit_instruction') {
          result = await processUserInputEvent(ctx, event, 'instruction', 0.95, 1.0)
        } else if (
          event.eventType === 'approval_granted' ||
          event.eventType === 'approval_rejected' ||
          event.eventType === 'feedback'
        ) {
          result = await processFeedbackOrApprovalEvent(ctx, event)
        } else {
          console.warn('[Extraction] Unrecognized event type — skipping:', {
            batchId,
            eventId: event._id,
            eventType: event.eventType,
            organizationId: String(event.organizationId),
          })
        }

        totalMemoriesCreated += result.memoriesCreated
        totalRelationsCreated += result.relationsCreated
        totalProcessed++

        await ctx.runMutation(internal.memoryEvents.markProcessed, {
          id: event._id,
          organizationId: event.organizationId,
        })
      } catch (error) {
        totalErrors++
        const errorMessage = error instanceof Error ? error.message : 'Unknown'
        console.error('[Extraction] Failed to process event:', {
          batchId,
          organizationId: String(event.organizationId),
          eventId: event._id,
          eventType: event.eventType,
          error: errorMessage,
        })

        await ctx.runMutation(internal.memoryEvents.markFailed, {
          id: event._id,
          organizationId: event.organizationId,
          error: errorMessage,
          maxRetries: MAX_EVENT_RETRIES,
        })
      }
    }

    const attempted = totalProcessed + totalErrors
    if (attempted > 0) {
      const failureRate = totalErrors / attempted
      if (failureRate > 0.2) {
        console.warn('[Reme:SLO] Extraction failure-rate breach', {
          batchId,
          processed: totalProcessed,
          errors: totalErrors,
          failureRate,
          threshold: 0.2,
        })
      }
    }

    if (DEBUG && (totalProcessed > 0 || totalErrors > 0)) {
      console.log('[Extraction] Batch complete:', {
        batchId,
        processed: totalProcessed,
        memoriesCreated: totalMemoriesCreated,
        relationsCreated: totalRelationsCreated,
        errors: totalErrors,
        durationMs: Date.now() - batchStartMs,
        provider: provider.name,
      })
    }

    return {
      processed: totalProcessed,
      memoriesCreated: totalMemoriesCreated,
      relationsCreated: totalRelationsCreated,
      errors: totalErrors,
    }
  },
})

/**
 * One-time maintenance action to find and archive duplicate business memories.
 * Uses pairwise cosine similarity via vector search.
 * Run manually: npx convex run --no-push memoryExtraction:deduplicateMemories '{"organizationId": "..."}'
 */
export const deduplicateMemories = internalAction({
  args: {
    organizationId: v.id('organizations'),
    dryRun: v.optional(v.boolean()),
    threshold: v.optional(v.float64()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ checked: number; archived: number; kept: number; pairs: string[] }> => {
    const similarityThreshold = args.threshold ?? DEDUP_SIMILARITY_THRESHOLD
    const isDryRun = args.dryRun ?? false

    const memories: Doc<'businessMemories'>[] = await ctx.runQuery(
      internal.memoryExtraction.getAllActiveBusinessMemories,
      { organizationId: args.organizationId }
    )

    if (memories.length < 2) {
      return { checked: memories.length, archived: 0, kept: memories.length, pairs: [] }
    }

    const archivedIds = new Set<string>()
    const pairs: string[] = []

    for (const mem of memories) {
      if (archivedIds.has(mem._id)) continue
      if (!mem.embedding) continue

      let results: Array<{ document: Doc<'businessMemories'>; score: number }>
      try {
        results = await ctx.runAction(internal.vectorSearch.searchBusinessMemories, {
          embedding: mem.embedding,
          organizationId: args.organizationId,
          limit: 10,
        })
      } catch {
        continue
      }

      for (const result of results) {
        if (result.document._id === mem._id) continue
        if (archivedIds.has(result.document._id)) continue
        if (result.score < similarityThreshold) continue

        const keepMem =
          mem.confidence > result.document.confidence ||
          (mem.confidence === result.document.confidence &&
            mem.version >= result.document.version) ||
          (mem.confidence === result.document.confidence &&
            mem.version === result.document.version &&
            mem.createdAt >= result.document.createdAt)
            ? mem
            : result.document
        const archiveMem = keepMem._id === mem._id ? result.document : mem

        pairs.push(
          `[${result.score.toFixed(3)}] KEEP: "${keepMem.content.slice(0, 60)}..." | ARCHIVE: "${archiveMem.content.slice(0, 60)}..."`
        )

        if (!isDryRun) {
          await ctx.runMutation(internal.memoryExtraction.archiveBusinessMemory, {
            id: archiveMem._id,
            organizationId: args.organizationId,
          })
        }

        archivedIds.add(archiveMem._id)
      }
    }

    return {
      checked: memories.length,
      archived: archivedIds.size,
      kept: memories.length - archivedIds.size,
      pairs,
    }
  },
})

export const getAllActiveBusinessMemories = internalQuery({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) => {
    // Capped at 500 to prevent unbounded reads in Convex queries.
    // Callers that need full coverage should paginate using getActiveBusinessBatch.
    return await ctx.db
      .query('businessMemories')
      .withIndex('by_org_active', (q) =>
        q.eq('organizationId', args.organizationId).eq('isActive', true)
      )
      .take(500)
  },
})

export const archiveBusinessMemory = internalMutation({
  args: {
    id: v.id('businessMemories'),
    organizationId: v.id('organizations'),
  },
  handler: async (ctx, args) => {
    const mem = await ctx.db.get(args.id)
    if (!mem || mem.organizationId !== args.organizationId) return
    await ctx.db.patch(args.id, {
      isActive: false,
      isArchived: true,
      updatedAt: Date.now(),
    })
  },
})

/**
 * Re-extract memories from a specific conversation.
 * Use when extraction failed (e.g., stale conversationId in event data).
 * Run: npx convex run --no-push memoryExtraction:reExtractConversation '{"organizationId": "...", "conversationId": "..."}'
 */
export const reExtractConversation = internalAction({
  args: {
    organizationId: v.id('organizations'),
    conversationId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ memoriesCreated: number; relationsCreated: number; messageCount: number }> => {
    const provider = resolveLLMProvider()

    const [messages, existingMemories] = await Promise.all([
      ctx.runQuery(internal.memoryExtraction.getConversationMessages, {
        organizationId: args.organizationId,
        conversationId: args.conversationId,
        limit: MAX_MESSAGES_FOR_EXTRACTION,
      }),
      ctx.runQuery(internal.memoryExtraction.getExistingMemoryContents, {
        organizationId: args.organizationId,
        limit: 50,
      }),
    ])

    if (messages.length < 2) {
      console.warn('[Extraction] reExtractConversation: not enough messages', {
        conversationId: args.conversationId,
        messageCount: messages.length,
      })
      return { memoriesCreated: 0, relationsCreated: 0, messageCount: messages.length }
    }

    const conversationText = formatConversation(messages)
    const llmResult = await callExtractionLLM(provider, conversationText, existingMemories)

    if (DEBUG) {
      console.log('[Extraction] reExtractConversation LLM result:', {
        conversationId: args.conversationId,
        businessMemories: llmResult.extraction.businessMemories.length,
        agentMemories: llmResult.extraction.agentMemories.length,
        relations: llmResult.extraction.relations.length,
      })
    }

    const result = await createExtractedMemories(
      ctx,
      args.organizationId,
      llmResult.extraction,
      args.conversationId
    )

    if (llmResult.totalTokens > 0) {
      try {
        await ctx.runMutation(internal.llmUsage.record, {
          organizationId: args.organizationId,
          model: provider.model,
          provider: provider.providerId,
          inputTokens: llmResult.inputTokens,
          outputTokens: llmResult.outputTokens,
          totalTokens: llmResult.totalTokens,
          estimatedCostUsd:
            llmResult.exactCostUsd ??
            estimateCost(provider.model, llmResult.inputTokens, llmResult.outputTokens),
          purpose: 'extraction' as const,
          cached: false,
          latencyMs: llmResult.latencyMs,
        })
      } catch {
        // Non-critical: swallow usage recording failures
      }
    }

    return { ...result, messageCount: messages.length }
  },
})

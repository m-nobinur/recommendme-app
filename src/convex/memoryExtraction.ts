import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { isEmbeddingConfigured } from './embedding'

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
 * │    │   ├─ Dedup: vector similarity ≥ 0.85 → skip or version bump   │
 * │    │   ├─ Create businessMemories (internalMutation)                │
 * │    │   ├─ Create agentMemories (internalMutation)                   │
 * │    │   ├─ Create memoryRelations (internalMutation)                 │
 * │    │   └─ markProcessed(eventId)                                    │
 * │    └─ Return summary                                                │
 * └─────────────────────────────────────────────────────────────────────┘
 */

// ============================================
// Constants
// ============================================

const EXTRACTION_BATCH_SIZE = 5
const MAX_MESSAGES_FOR_EXTRACTION = 30
const DEDUP_SIMILARITY_THRESHOLD = 0.85
const DEDUP_SEARCH_LIMIT = 10
const MAX_LLM_RETRIES = 2

const LLM_PROVIDERS = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    envVar: 'OPENROUTER_API_KEY',
    model: 'openai/gpt-4o-mini',
    name: 'OpenRouter',
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    envVar: 'OPENAI_API_KEY',
    model: 'gpt-4o-mini',
    name: 'OpenAI',
  },
} as const

type LLMProviderKey = keyof typeof LLM_PROVIDERS

// ============================================
// LLM Provider Resolution
// ============================================

interface ResolvedLLMProvider {
  url: string
  apiKey: string
  model: string
  name: string
}

function resolveLLMProvider(): ResolvedLLMProvider {
  const order: LLMProviderKey[] = ['openrouter', 'openai']

  for (const key of order) {
    const provider = LLM_PROVIDERS[key]
    const apiKey = process.env[provider.envVar]
    if (apiKey && apiKey.trim().length > 0) {
      return { url: provider.url, apiKey, model: provider.model, name: provider.name }
    }
  }

  throw new ConvexError({
    code: 'CONFIGURATION_ERROR',
    message: 'No LLM provider configured for extraction. Set OPENROUTER_API_KEY or OPENAI_API_KEY.',
  })
}

// ============================================
// LLM Call
// ============================================

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

## Rules
1. Extract ONLY information explicitly stated or strongly implied
2. Each memory must be self-contained — understandable without the conversation
3. Do NOT extract generic knowledge without specific context
4. Do NOT extract the AI's responses — only what the USER reveals
5. Prefer specific, named entities
6. Set importance: client preferences (0.8+), business rules (0.9+), one-time context (0.3-0.5)
7. Set confidence: 1.0 for explicit, 0.7-0.9 for inferred
8. Return empty arrays if no extractable knowledge
9. Avoid redundancy

Respond with valid JSON matching this exact structure:
{
  "businessMemories": [{ "type": "fact|preference|instruction|context|relationship|episodic", "content": "...", "importance": 0.0-1.0, "confidence": 0.5-1.0, "subjectType": "lead|service|appointment|invoice|general", "subjectName": "..." }],
  "agentMemories": [{ "agentType": "chat|crm|followup|invoice|sales|reminder", "category": "pattern|preference|success|failure", "content": "...", "confidence": 0.5-1.0 }],
  "relations": [{ "sourceType": "...", "sourceName": "...", "targetType": "...", "targetName": "...", "relationType": "prefers|related_to|leads_to|requires|conflicts_with", "strength": 0.0-1.0, "evidence": "..." }]
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
}

async function callExtractionLLM(
  provider: ResolvedLLMProvider,
  conversationText: string,
  existingMemories: string[]
): Promise<ExtractionResult> {
  let userPrompt = `## Conversation Transcript\n\n${conversationText}`

  if (existingMemories.length > 0) {
    userPrompt += '\n\n## Already Known (do NOT re-extract)\n'
    for (const mem of existingMemories) {
      userPrompt += `- ${mem}\n`
    }
  }

  userPrompt += '\nExtract all relevant memories from the conversation above. Return JSON only.'

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
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

      const parsed = JSON.parse(content) as ExtractionResult
      return {
        businessMemories: Array.isArray(parsed.businessMemories) ? parsed.businessMemories : [],
        agentMemories: Array.isArray(parsed.agentMemories) ? parsed.agentMemories : [],
        relations: Array.isArray(parsed.relations) ? parsed.relations : [],
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.warn('[Extraction] LLM returned invalid JSON, retrying:', {
          attempt,
          error: error.message,
        })
      }
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < MAX_LLM_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
      }
    }
  }

  console.error('[Extraction] LLM call failed after retries:', {
    error: lastError?.message,
  })
  return { businessMemories: [], agentMemories: [], relations: [] }
}

// ============================================
// Tool Outcome Summarization
// ============================================

async function summarizeToolOutcome(
  provider: ResolvedLLMProvider,
  toolName: string,
  isSuccess: boolean,
  argsStr: string,
  resultStr: string
): Promise<string> {
  const fallback = isSuccess
    ? `Tool "${toolName}" succeeded: ${argsStr.slice(0, 100)}`
    : `Tool "${toolName}" failed: ${resultStr.slice(0, 100)}`

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
      if (content && content.length >= 10 && content.length <= 500) {
        return content
      }
    }
  } catch {
    // Use fallback
  }

  return fallback.slice(0, 500)
}

// ============================================
// Internal Queries
// ============================================

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
      .filter((q) => q.eq(q.field('processed'), false))
      .take(pageSize)
  },
})

// ============================================
// Validation Helpers
// ============================================

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

// ============================================
// Conversation Formatting
// ============================================

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

// ============================================
// Deduplication
// ============================================

async function isDuplicate(
  ctx: any,
  content: string,
  organizationId: any
): Promise<{ isDup: boolean; existingId?: string; existingConfidence?: number }> {
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

// ============================================
// Internal Mutations (database writes)
// ============================================

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

// ============================================
// Memory Creation Orchestrator
// ============================================

async function createExtractedMemories(
  ctx: any,
  organizationId: any,
  extraction: ExtractionResult,
  sourceId: string
): Promise<{ memoriesCreated: number; relationsCreated: number }> {
  let memoriesCreated = 0
  let relationsCreated = 0

  for (const mem of extraction.businessMemories) {
    if (!isValidBusinessMemory(mem)) continue

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
          })

          memoriesCreated++
        } catch (error) {
          console.warn('[Extraction] Failed to update existing memory:', {
            error: error instanceof Error ? error.message : 'Unknown',
          })
        }
      }
      continue
    }

    try {
      const id = await ctx.runMutation(internal.memoryExtraction.insertBusinessMemory, {
        organizationId,
        type: mem.type as any,
        content: mem.content,
        importance: mem.importance,
        confidence: mem.confidence,
        subjectType: mem.subjectType,
        subjectId: mem.subjectName,
        source: 'extraction' as const,
        sourceMessageId: sourceId,
      })

      await ctx.runAction(internal.embedding.generateAndStore, {
        tableName: 'businessMemories' as const,
        documentId: id,
        content: mem.content,
      })

      memoriesCreated++
    } catch (error) {
      console.warn('[Extraction] Failed to create business memory:', {
        content: mem.content.slice(0, 50),
        error: error instanceof Error ? error.message : 'Unknown',
      })
    }
  }

  for (const mem of extraction.agentMemories) {
    if (!isValidAgentMemory(mem)) continue

    try {
      const id = await ctx.runMutation(internal.memoryExtraction.insertAgentMemory, {
        organizationId,
        agentType: mem.agentType,
        category: mem.category as any,
        content: mem.content,
        confidence: mem.confidence,
      })

      await ctx.runAction(internal.embedding.generateAndStore, {
        tableName: 'agentMemories' as const,
        documentId: id,
        content: mem.content,
      })

      memoriesCreated++
    } catch (error) {
      console.warn('[Extraction] Failed to create agent memory:', {
        content: mem.content.slice(0, 50),
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
        sourceId: rel.sourceName,
        targetType: rel.targetType,
        targetId: rel.targetName,
        relationType: rel.relationType as any,
        strength: rel.strength,
        evidence: rel.evidence.slice(0, 200),
      })
      relationsCreated++
    } catch (error) {
      console.warn('[Extraction] Failed to create relation:', {
        error: error instanceof Error ? error.message : 'Unknown',
      })
    }
  }

  return { memoriesCreated, relationsCreated }
}

// ============================================
// Per-Event Processing
// ============================================

async function processConversationEnd(
  ctx: any,
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
    return { memoriesCreated: 0, relationsCreated: 0 }
  }

  const conversationText = formatConversation(messages)
  const extraction = await callExtractionLLM(provider, conversationText, existingMemories)

  return createExtractedMemories(ctx, event.organizationId, extraction, event.sourceId)
}

async function processToolOutcome(
  ctx: any,
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

  const summary = await summarizeToolOutcome(provider, toolName, isSuccess, argsStr, resultStr)

  if (summary.length < 10) {
    return { memoriesCreated: 0, relationsCreated: 0 }
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
    })

    return { memoriesCreated: 1, relationsCreated: 0 }
  } catch (error) {
    console.error('[Extraction] Failed to create agent memory from tool outcome:', {
      error: error instanceof Error ? error.message : 'Unknown',
    })
    return { memoriesCreated: 0, relationsCreated: 0 }
  }
}

// ============================================
// Main Extraction Action
// ============================================

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

    let totalProcessed = 0
    let totalMemoriesCreated = 0
    let totalRelationsCreated = 0
    let totalErrors = 0

    const provider = resolveLLMProvider()

    for (const event of events) {
      try {
        let result = { memoriesCreated: 0, relationsCreated: 0 }

        if (event.eventType === 'conversation_end') {
          result = await processConversationEnd(ctx, event, provider)
        } else if (event.eventType === 'tool_success' || event.eventType === 'tool_failure') {
          result = await processToolOutcome(ctx, event, provider)
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
        console.error('[Extraction] Failed to process event:', {
          eventId: event._id,
          eventType: event.eventType,
          error: error instanceof Error ? error.message : 'Unknown',
        })

        await ctx.runMutation(internal.memoryEvents.markProcessed, {
          id: event._id,
          organizationId: event.organizationId,
        })
      }
    }

    console.log('[Extraction] Batch complete:', {
      processed: totalProcessed,
      memoriesCreated: totalMemoriesCreated,
      relationsCreated: totalRelationsCreated,
      errors: totalErrors,
    })

    return {
      processed: totalProcessed,
      memoriesCreated: totalMemoriesCreated,
      relationsCreated: totalRelationsCreated,
      errors: totalErrors,
    }
  },
})

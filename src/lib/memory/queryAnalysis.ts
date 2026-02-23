/**
 * Query Analysis Service
 *
 * Two-tier intent detection:
 *   1. Fast path (sync): regex/heuristic matching — handles obvious intents instantly
 *   2. AI fallback (async): fast model call — resolves ambiguous "general" intents
 *
 * Entity extraction remains regex-only (fast enough for all cases).
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  QUERY ANALYSIS PIPELINE                                         │
 * │                                                                  │
 * │  User Message                                                    │
 * │    ↓ detectIntents()  — keyword matching (sync, <1ms)            │
 * │  Intent[]                                                        │
 * │    ├── if specific intent found → use it (fast path)             │
 * │    └── if only 'general' → detectIntentsWithAI() (async, ~200ms)│
 * │    ↓ extractEntities()  — regex patterns                        │
 * │  Entity[]                                                        │
 * │    ↓ mapIntentsToContextTypes()                                 │
 * │  BusinessMemoryType[]                                            │
 * │    ↓ buildSubjectHints()                                        │
 * │  SubjectHint[]                                                   │
 * │                                                                  │
 * │  Output: QueryAnalysis                                           │
 * └──────────────────────────────────────────────────────────────────┘
 */

import { generateText, Output } from 'ai'
import { z } from 'zod'
import type { BusinessMemoryType } from '@/types'
import { getAIConfig } from '../ai/config'
import { createAIProvider } from '../ai/providers'

// ============================================
// TYPES
// ============================================

export type QueryIntent =
  | 'scheduling'
  | 'lead_management'
  | 'invoicing'
  | 'general'
  | 'memory_query'

export interface QueryEntity {
  type: 'customer' | 'date' | 'service' | 'amount'
  value: string
}

export interface SubjectHint {
  subjectType: string
  subjectId?: string
  name?: string
}

export interface QueryAnalysis {
  intents: QueryIntent[]
  entities: QueryEntity[]
  requiredContextTypes: BusinessMemoryType[]
  subjectHints: SubjectHint[]
  aiAssisted?: boolean
}

// ============================================
// INTENT PATTERNS (hoisted to module scope)
// ============================================

const SCHEDULING_PATTERN =
  /\b(schedule|appointment|book|booking|cancel|reschedule|available|availability|calendar|time\s?slot|when|remind(?:er)?)\b/i

const LEAD_MANAGEMENT_PATTERN =
  /\b(lead|customer|client|contact|prospect|follow\s?up|pipeline|funnel|status|qualified|proposal)\b/i

const INVOICING_PATTERN =
  /\b(invoice|bill|payment|charge|price|cost|amount|total|due|paid|receipt|estimate|quote)\b/i

const MEMORY_QUERY_PATTERN =
  /\b(remember|recall|what\s+do\s+you\s+know|(?:know|tell\s+me)\s+about|what\s+did\s+(?:i|we)\s+(?:say|tell|mention)|forget|preference|prefer|always|never|last\s+time)\b/i

// ============================================
// ENTITY PATTERNS (hoisted to module scope)
// ============================================

/**
 * Detect capitalized proper nouns (2+ words) that likely represent names.
 * Excludes common non-name capitalized words.
 */
const PROPER_NOUN_PATTERN = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g

/**
 * Single-word name pattern: catches "Sarah", "Mike", etc.
 * Applied after multi-word pattern to avoid duplicates.
 * Only matches words with 3+ chars that start with a capital letter,
 * preceded by name-context keywords.
 */
const SINGLE_NAME_CONTEXT_PATTERN =
  /\b(?:about|for|with|from|named?|called|contact|client|customer|lead)\s+([A-Z][a-z]{2,})\b/gi

/**
 * Lowercase name pattern: catches "sarah", "mike" in name-context phrases.
 * Falls back when proper capitalization is missing.
 */
const LOWERCASE_NAME_CONTEXT_PATTERN =
  /\b(?:about|for|with|from|named?|called|contact|client|customer|lead)\s+([a-z]{3,})\b/gi

/** Common words that look like proper nouns but aren't */
const NON_NAME_WORDS = new Set([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
  'New Lead',
  'The Client',
])

const NON_NAME_LOWERCASE = new Set([
  'today',
  'tomorrow',
  'yesterday',
  'morning',
  'afternoon',
  'evening',
  'nothing',
  'something',
  'everything',
  'anyone',
  'someone',
  'everyone',
  'the',
  'that',
  'this',
  'them',
  'their',
])

/** Date-like patterns */
const DATE_PATTERN =
  /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2}|(?:next|this|last)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)|tomorrow|today|yesterday)\b/gi

/** Currency/amount patterns */
const AMOUNT_PATTERN = /\$\s?[\d,]+(?:\.\d{2})?|\b\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:dollars?|usd)\b/gi

// ============================================
// INTENT TO MEMORY TYPE MAPPING
// ============================================

const INTENT_CONTEXT_MAP: Record<QueryIntent, BusinessMemoryType[]> = {
  scheduling: ['fact', 'preference', 'instruction'],
  lead_management: ['fact', 'relationship', 'context'],
  invoicing: ['fact', 'preference', 'instruction'],
  memory_query: ['fact', 'preference', 'instruction', 'context', 'relationship'],
  general: ['fact', 'instruction'],
}

// ============================================
// AI INTENT DETECTION SCHEMA
// ============================================

/** Zod schema for structured AI intent output */
const aiIntentSchema = z.object({
  intents: z
    .array(z.enum(['scheduling', 'lead_management', 'invoicing', 'memory_query', 'general']))
    .min(1)
    .describe('Detected user intents from the message'),
})

/** System prompt for fast intent classification */
const INTENT_SYSTEM_PROMPT = `You are an intent classifier for a CRM assistant. Classify the user message into one or more intents.

Available intents:
- scheduling: Anything about appointments, bookings, calendar, time slots, reminders, availability
- lead_management: Anything about leads, customers, clients, contacts, prospects, pipeline, follow-ups, proposals
- invoicing: Anything about invoices, bills, payments, pricing, costs, estimates, quotes, receipts
- memory_query: When the user asks what the system remembers, their preferences, past interactions, or asks to remember/forget something
- general: ONLY use this if the message truly doesn't fit any other intent. Most CRM messages have a specific intent.

Rules:
- Prefer specific intents over general
- A message can have multiple intents (e.g. "schedule a followup with the lead" = scheduling + lead_management)
- Short/ambiguous messages should still be classified if there's any CRM-related signal`

// ============================================
// CACHED RESULTS
// ============================================

/** Pre-built empty analysis result for empty/whitespace-only input (rule 7.8, 7.4) */
const EMPTY_ANALYSIS: QueryAnalysis = {
  intents: ['general'],
  entities: [],
  requiredContextTypes: ['fact', 'instruction'],
  subjectHints: [],
}

/** Valid intent values for runtime validation */
const VALID_INTENTS = new Set<QueryIntent>([
  'scheduling',
  'lead_management',
  'invoicing',
  'memory_query',
  'general',
])

// ============================================
// ANALYSIS FUNCTIONS
// ============================================

/**
 * Detect intents from message text using regex patterns.
 * Returns all matching intents; defaults to 'general' if none match.
 */
function detectIntents(message: string): QueryIntent[] {
  const intents: QueryIntent[] = []

  if (SCHEDULING_PATTERN.test(message)) intents.push('scheduling')
  if (LEAD_MANAGEMENT_PATTERN.test(message)) intents.push('lead_management')
  if (INVOICING_PATTERN.test(message)) intents.push('invoicing')
  if (MEMORY_QUERY_PATTERN.test(message)) intents.push('memory_query')

  if (intents.length === 0) intents.push('general')

  return intents
}

/**
 * AI-powered intent detection using a fast model.
 *
 * Called ONLY when regex returns 'general' — avoids unnecessary LLM calls
 * for obvious intents. Uses the `regular` tier (fastest/cheapest model)
 * with structured output for reliable parsing.
 *
 * Graceful degradation: on any error, falls back to 'general'.
 */
async function detectIntentsWithAI(message: string): Promise<QueryIntent[]> {
  try {
    const config = getAIConfig()
    const model = createAIProvider(config.defaultProvider, 'regular')

    const { output } = await generateText({
      model,
      output: Output.object({ schema: aiIntentSchema }),
      system: INTENT_SYSTEM_PROMPT,
      prompt: message,
      temperature: 0,
      maxOutputTokens: 100,
    })

    if (!output) return ['general']

    const validIntents = output.intents.filter((i) => VALID_INTENTS.has(i as QueryIntent))
    if (validIntents.length === 0) return ['general']
    return validIntents as QueryIntent[]
  } catch (error) {
    console.warn('[Reme:QueryAnalysis] AI intent detection failed, using "general":', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return ['general']
  }
}

/**
 * Extract entities (names, dates, amounts) from message text.
 * Uses a multi-pass strategy:
 *   1. Multi-word proper nouns ("Sarah Johnson")
 *   2. Single capitalized names in context ("about Sarah")
 *   3. Lowercase names in context ("about sarah") -- normalized to Title Case
 */
function extractEntities(message: string): QueryEntity[] {
  const entities: QueryEntity[] = []
  const seenNames = new Set<string>()

  PROPER_NOUN_PATTERN.lastIndex = 0
  for (
    let nameMatch = PROPER_NOUN_PATTERN.exec(message);
    nameMatch !== null;
    nameMatch = PROPER_NOUN_PATTERN.exec(message)
  ) {
    const name = nameMatch[1]
    if (!NON_NAME_WORDS.has(name) && !seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase())
      entities.push({ type: 'customer', value: name })
    }
  }

  SINGLE_NAME_CONTEXT_PATTERN.lastIndex = 0
  for (
    let match = SINGLE_NAME_CONTEXT_PATTERN.exec(message);
    match !== null;
    match = SINGLE_NAME_CONTEXT_PATTERN.exec(message)
  ) {
    const name = match[1]
    if (!NON_NAME_WORDS.has(name) && !seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase())
      entities.push({ type: 'customer', value: name })
    }
  }

  if (entities.filter((e) => e.type === 'customer').length === 0) {
    LOWERCASE_NAME_CONTEXT_PATTERN.lastIndex = 0
    for (
      let match = LOWERCASE_NAME_CONTEXT_PATTERN.exec(message);
      match !== null;
      match = LOWERCASE_NAME_CONTEXT_PATTERN.exec(message)
    ) {
      const raw = match[1]
      if (!NON_NAME_LOWERCASE.has(raw) && !seenNames.has(raw.toLowerCase())) {
        const titleCase = raw.charAt(0).toUpperCase() + raw.slice(1)
        seenNames.add(raw.toLowerCase())
        entities.push({ type: 'customer', value: titleCase })
      }
    }
  }

  DATE_PATTERN.lastIndex = 0
  for (
    let dateMatch = DATE_PATTERN.exec(message);
    dateMatch !== null;
    dateMatch = DATE_PATTERN.exec(message)
  ) {
    entities.push({ type: 'date', value: dateMatch[0] })
  }

  AMOUNT_PATTERN.lastIndex = 0
  for (
    let amountMatch = AMOUNT_PATTERN.exec(message);
    amountMatch !== null;
    amountMatch = AMOUNT_PATTERN.exec(message)
  ) {
    entities.push({ type: 'amount', value: amountMatch[0] })
  }

  return entities
}

/**
 * Map detected intents to required business memory types.
 * Uses a Set to deduplicate across multiple intents.
 */
function mapIntentsToContextTypes(intents: QueryIntent[]): BusinessMemoryType[] {
  const typeSet = new Set<BusinessMemoryType>()

  for (const intent of intents) {
    const types = INTENT_CONTEXT_MAP[intent]
    for (const t of types) {
      typeSet.add(t)
    }
  }

  return Array.from(typeSet)
}

/**
 * Build subject hints from extracted entities.
 * Customer names become subject hints for targeted memory lookup.
 */
function buildSubjectHints(entities: QueryEntity[]): SubjectHint[] {
  const hints: SubjectHint[] = []

  for (const entity of entities) {
    if (entity.type === 'customer') {
      hints.push({ subjectType: 'lead', name: entity.value })
    }
  }

  return hints
}

// ============================================
// MAIN EXPORTS
// ============================================

/**
 * Analyze a user message (sync path).
 *
 * Uses regex/heuristics only. Fast (<1ms) but will return 'general'
 * for ambiguous messages. Use `analyzeQueryAsync` for AI-assisted analysis.
 *
 * @param message - The user's message text
 * @returns QueryAnalysis with intents, entities, required types, and subject hints
 */
export function analyzeQuery(message: string): QueryAnalysis {
  if (!message || message.trim().length === 0) {
    return EMPTY_ANALYSIS
  }

  const intents = detectIntents(message)
  const entities = extractEntities(message)
  const requiredContextTypes = mapIntentsToContextTypes(intents)
  const subjectHints = buildSubjectHints(entities)

  return { intents, entities, requiredContextTypes, subjectHints }
}

/**
 * Analyze a user message with AI fallback (async path).
 *
 * Strategy:
 *   1. Run regex detection first (sync, <1ms)
 *   2. If regex found a specific intent → use it (fast path, no AI call)
 *   3. If regex returned only 'general' → call fast AI model for better classification
 *
 * This ensures:
 *   - Obvious intents (with keywords) are instant
 *   - Ambiguous messages get AI-quality classification
 *   - AI failures gracefully degrade to 'general'
 *
 * @param message - The user's message text
 * @returns QueryAnalysis with intents, entities, and aiAssisted flag
 */
export async function analyzeQueryAsync(message: string): Promise<QueryAnalysis> {
  if (!message || message.trim().length === 0) {
    return EMPTY_ANALYSIS
  }

  let intents = detectIntents(message)
  let aiAssisted = false

  if (intents.length === 1 && intents[0] === 'general') {
    intents = await detectIntentsWithAI(message)
    aiAssisted = true
  }

  const entities = extractEntities(message)
  const requiredContextTypes = mapIntentsToContextTypes(intents)
  const subjectHints = buildSubjectHints(entities)

  return { intents, entities, requiredContextTypes, subjectHints, aiAssisted }
}

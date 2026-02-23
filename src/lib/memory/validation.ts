/**
 * Memory Validation Library
 *
 * Content length validation, confidence scoring, PII detection,
 * and type-specific validation rules for the 4-layer memory system.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                  VALIDATION PIPELINE                                │
 * │                                                                     │
 * │  Every memory passes through validation before storage:             │
 * │                                                                     │
 * │  Input ──> validateMemory()                                         │
 * │              │                                                      │
 * │              ├─> validateContentLength()   10-500 chars             │
 * │              ├─> validateConfidence()      0.5-1.0 range            │
 * │              ├─> validateImportance()      0.0-1.0 range            │
 * │              ├─> validatePiiForLayer()     Layer-specific PII rules │
 * │              │     │                                                │
 * │              │     ├─ Platform: PII = ERROR (forbidden)             │
 * │              │     ├─ Niche:    PII = WARNING (should redact)       │
 * │              │     ├─ Business: PII = OK (encrypted at rest)        │
 * │              │     └─ Agent:    PII = WARNING (should redact)       │
 * │              │                                                      │
 * │              └─> Type-specific validators                           │
 * │                    ├─ business: validateBusinessMemoryType()        │
 * │                    ├─ agent:    validateAgentCategory()             │
 * │                    └─ platform: validatePlatformCategory()          │
 * │                                                                     │
 * │  Output: { valid: boolean, errors: string[], warnings: string[] }   │
 * │                                                                     │
 * │  Specialized Validators (for pipeline use):                         │
 * │  ──────────────────────────────────────────                         │
 * │  validateBusinessMemory()  -> content + confidence + importance     │
 * │                                + type + source + PII                │
 * │  validateAgentMemory()     -> content + confidence + category + PII │
 * │  validatePlatformMemory()  -> content + confidence + category + PII │
 * │  validateMemoryRelation()  -> relationType + strength + evidence    │
 * │                                                                     │
 * │  PII Detection:                                                     │
 * │  ──────────────                                                     │
 * │  containsPii() -> Fast boolean check (non-global regex .test())     │
 * │  detectPii()   -> Detailed report with type + count per pattern     │
 * │                                                                     │
 * │  Patterns: email, phone, SSN, credit card, IP address               │
 * │  Regex is hoisted to module scope (not recreated per call)          │
 * └─────────────────────────────────────────────────────────────────────┘
 */

import type {
  AgentMemoryCategory,
  BusinessMemoryType,
  MemoryEventSourceType,
  MemoryRelationType,
  MemorySource,
  PlatformMemoryCategory,
} from '@/types'

export type MemoryLayer = 'platform' | 'niche' | 'business' | 'agent'

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface MemoryInput {
  content: string
  confidence?: number
  importance?: number
  layer: MemoryLayer
  type?: BusinessMemoryType
  category?: string
}

const MIN_CONTENT_LENGTH = 10
const MAX_CONTENT_LENGTH = 500

const CONTENT_WARNING_THRESHOLD = MAX_CONTENT_LENGTH * 0.8

const MIN_CONFIDENCE = 0.5
const MAX_CONFIDENCE = 1.0

const MIN_IMPORTANCE = 0.0
const MAX_IMPORTANCE = 1.0

/** Cosine similarity threshold for duplicate detection */
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.92

/**
 * Pre-compiled regex patterns for PII detection.
 */
const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  phone: /\b(\+?1?\s*[-.]?\s*)?(\(?\d{3}\)?)\s*[-.]?\s*(\d{3})\s*[-.]?\s*(\d{4})\b/,
  ssn: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/,
  creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  ipAddress: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
} as const

/**
 * Pre-compiled global regex patterns for counting PII occurrences.
 */
const PII_GLOBAL_PATTERNS: Record<PiiType, RegExp> = {
  email: new RegExp(PII_PATTERNS.email.source, 'g'),
  phone: new RegExp(PII_PATTERNS.phone.source, 'g'),
  ssn: new RegExp(PII_PATTERNS.ssn.source, 'g'),
  creditCard: new RegExp(PII_PATTERNS.creditCard.source, 'g'),
  ipAddress: new RegExp(PII_PATTERNS.ipAddress.source, 'g'),
}

type PiiType = keyof typeof PII_PATTERNS

interface PiiDetection {
  type: PiiType
  found: boolean
  count: number
}

const VALID_BUSINESS_MEMORY_TYPES: readonly BusinessMemoryType[] = [
  'fact',
  'preference',
  'instruction',
  'context',
  'relationship',
  'episodic',
] as const

const VALID_AGENT_CATEGORIES: readonly AgentMemoryCategory[] = [
  'pattern',
  'preference',
  'success',
  'failure',
] as const

const VALID_PLATFORM_CATEGORIES: readonly PlatformMemoryCategory[] = [
  'sales',
  'scheduling',
  'pricing',
  'communication',
  'followup',
] as const

const VALID_MEMORY_SOURCES: readonly MemorySource[] = [
  'extraction',
  'explicit',
  'tool',
  'system',
] as const

const VALID_RELATION_TYPES: readonly MemoryRelationType[] = [
  'prefers',
  'related_to',
  'leads_to',
  'requires',
  'conflicts_with',
] as const

const VALID_EVENT_SOURCE_TYPES: readonly MemoryEventSourceType[] = [
  'message',
  'tool_call',
  'agent_action',
] as const

/**
 * Validate memory content length
 */
export function validateContentLength(content: string): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const trimmedLength = content.trim().length

  if (!content || trimmedLength === 0) {
    errors.push('Content cannot be empty')
  } else if (trimmedLength < MIN_CONTENT_LENGTH) {
    errors.push(`Content too short: ${trimmedLength} chars (minimum: ${MIN_CONTENT_LENGTH})`)
  } else if (trimmedLength > MAX_CONTENT_LENGTH) {
    errors.push(`Content too long: ${trimmedLength} chars (maximum: ${MAX_CONTENT_LENGTH})`)
  }

  if (trimmedLength > CONTENT_WARNING_THRESHOLD && trimmedLength <= MAX_CONTENT_LENGTH) {
    warnings.push('Content is approaching maximum length')
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate confidence score
 */
export function validateConfidence(confidence: number): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    errors.push('Confidence must be a valid number')
  } else if (confidence < MIN_CONFIDENCE) {
    errors.push(`Confidence too low: ${confidence} (minimum: ${MIN_CONFIDENCE})`)
  } else if (confidence > MAX_CONFIDENCE) {
    errors.push(`Confidence exceeds maximum: ${confidence} (maximum: ${MAX_CONFIDENCE})`)
  }

  if (confidence > 0.5 && confidence < 0.6) {
    warnings.push('Low confidence memory - may not be reliable')
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate importance score
 */
export function validateImportance(importance: number): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (typeof importance !== 'number' || Number.isNaN(importance)) {
    errors.push('Importance must be a valid number')
  } else if (importance < MIN_IMPORTANCE) {
    errors.push(`Importance below minimum: ${importance} (minimum: ${MIN_IMPORTANCE})`)
  } else if (importance > MAX_IMPORTANCE) {
    errors.push(`Importance exceeds maximum: ${importance} (maximum: ${MAX_IMPORTANCE})`)
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Detect PII patterns in content.
 */
export function detectPii(content: string): PiiDetection[] {
  const detections: PiiDetection[] = []

  for (const type of Object.keys(PII_PATTERNS) as PiiType[]) {
    const globalPattern = PII_GLOBAL_PATTERNS[type]
    globalPattern.lastIndex = 0
    const matches = content.match(globalPattern)

    detections.push({
      type,
      found: matches !== null,
      count: matches?.length ?? 0,
    })
  }

  return detections
}

/**
 * Check if content contains PII (fast path using non-global test patterns)
 */
export function containsPii(content: string): boolean {
  for (const pattern of Object.values(PII_PATTERNS)) {
    if (pattern.test(content)) {
      return true
    }
  }
  return false
}

/**
 * Validate PII handling for a memory layer
 *
 * - Platform layer: PII is forbidden
 * - Niche layer: PII should be redacted (warning)
 * - Business layer: PII is allowed (stored encrypted in practice)
 * - Agent layer: PII should be redacted (warning)
 */
export function validatePiiForLayer(content: string, layer: MemoryLayer): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const hasPii = containsPii(content)

  if (hasPii) {
    switch (layer) {
      case 'platform':
        errors.push('PII detected in platform memory - PII is forbidden at the platform layer')
        break
      case 'niche':
        warnings.push('PII detected in niche memory - should be redacted before storage')
        break
      case 'business':
        break
      case 'agent':
        warnings.push('PII detected in agent memory - should be redacted before storage')
        break
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate business memory type
 */
export function validateBusinessMemoryType(type: string): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!VALID_BUSINESS_MEMORY_TYPES.includes(type as BusinessMemoryType)) {
    errors.push(
      `Invalid memory type: "${type}". Valid types: ${VALID_BUSINESS_MEMORY_TYPES.join(', ')}`
    )
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate agent category
 */
export function validateAgentCategory(category: string): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!VALID_AGENT_CATEGORIES.includes(category as AgentMemoryCategory)) {
    errors.push(
      `Invalid agent category: "${category}". Valid categories: ${VALID_AGENT_CATEGORIES.join(', ')}`
    )
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate platform category
 */
export function validatePlatformCategory(category: string): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!VALID_PLATFORM_CATEGORIES.includes(category as PlatformMemoryCategory)) {
    errors.push(
      `Invalid platform category: "${category}". Valid categories: ${VALID_PLATFORM_CATEGORIES.join(', ')}`
    )
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate memory source
 */
export function validateSource(source: string): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!VALID_MEMORY_SOURCES.includes(source as MemorySource)) {
    errors.push(`Invalid source: "${source}". Valid sources: ${VALID_MEMORY_SOURCES.join(', ')}`)
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate relation type
 */
export function validateRelationType(relationType: string): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!VALID_RELATION_TYPES.includes(relationType as MemoryRelationType)) {
    errors.push(
      `Invalid relation type: "${relationType}". Valid types: ${VALID_RELATION_TYPES.join(', ')}`
    )
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate event source type
 */
export function validateEventSourceType(sourceType: string): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!VALID_EVENT_SOURCE_TYPES.includes(sourceType as MemoryEventSourceType)) {
    errors.push(
      `Invalid event source type: "${sourceType}". Valid types: ${VALID_EVENT_SOURCE_TYPES.join(', ')}`
    )
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Merge multiple validation results
 */
function mergeResults(...results: ValidationResult[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const result of results) {
    errors.push(...result.errors)
    warnings.push(...result.warnings)
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Full validation for a memory input
 */
export function validateMemory(input: MemoryInput): ValidationResult {
  const results: ValidationResult[] = []

  results.push(validateContentLength(input.content))

  if (input.confidence !== undefined) {
    results.push(validateConfidence(input.confidence))
  }

  if (input.importance !== undefined) {
    results.push(validateImportance(input.importance))
  }

  results.push(validatePiiForLayer(input.content, input.layer))

  if (input.layer === 'business' && input.type) {
    results.push(validateBusinessMemoryType(input.type))
  }

  if (input.layer === 'agent' && input.category) {
    results.push(validateAgentCategory(input.category))
  }

  if (input.layer === 'platform' && input.category) {
    results.push(validatePlatformCategory(input.category))
  }

  return mergeResults(...results)
}

/**
 * Validate a business memory specifically
 */
export function validateBusinessMemory(input: {
  content: string
  type: BusinessMemoryType
  confidence: number
  importance: number
  source: MemorySource
}): ValidationResult {
  return mergeResults(
    validateContentLength(input.content),
    validateConfidence(input.confidence),
    validateImportance(input.importance),
    validateBusinessMemoryType(input.type),
    validateSource(input.source),
    validatePiiForLayer(input.content, 'business')
  )
}

/**
 * Validate an agent memory specifically
 */
export function validateAgentMemory(input: {
  content: string
  category: AgentMemoryCategory
  confidence: number
}): ValidationResult {
  return mergeResults(
    validateContentLength(input.content),
    validateConfidence(input.confidence),
    validateAgentCategory(input.category),
    validatePiiForLayer(input.content, 'agent')
  )
}

/**
 * Validate a platform memory specifically
 */
export function validatePlatformMemory(input: {
  content: string
  category: PlatformMemoryCategory
  confidence: number
}): ValidationResult {
  return mergeResults(
    validateContentLength(input.content),
    validateConfidence(input.confidence),
    validatePlatformCategory(input.category),
    validatePiiForLayer(input.content, 'platform')
  )
}

/**
 * Validate a memory relation
 */
export function validateMemoryRelation(input: {
  relationType: string
  strength: number
  evidence: string
}): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const typeResult = validateRelationType(input.relationType)
  errors.push(...typeResult.errors)
  warnings.push(...typeResult.warnings)

  if (typeof input.strength !== 'number' || Number.isNaN(input.strength)) {
    errors.push('Strength must be a valid number')
  } else if (input.strength < 0 || input.strength > 1) {
    errors.push(`Strength must be between 0 and 1, got: ${input.strength}`)
  }

  if (!input.evidence || input.evidence.trim().length === 0) {
    errors.push('Evidence cannot be empty')
  } else if (input.evidence.trim().length < 5) {
    warnings.push('Evidence is very short - consider providing more detail')
  }

  return { valid: errors.length === 0, errors, warnings }
}

export const MEMORY_LIMITS = {
  MIN_CONTENT_LENGTH,
  MAX_CONTENT_LENGTH,
  MIN_CONFIDENCE,
  MAX_CONFIDENCE,
  MIN_IMPORTANCE,
  MAX_IMPORTANCE,
  DUPLICATE_SIMILARITY_THRESHOLD,
} as const

export const VALID_VALUES = {
  BUSINESS_MEMORY_TYPES: VALID_BUSINESS_MEMORY_TYPES,
  AGENT_CATEGORIES: VALID_AGENT_CATEGORIES,
  PLATFORM_CATEGORIES: VALID_PLATFORM_CATEGORIES,
  MEMORY_SOURCES: VALID_MEMORY_SOURCES,
  RELATION_TYPES: VALID_RELATION_TYPES,
  EVENT_SOURCE_TYPES: VALID_EVENT_SOURCE_TYPES,
} as const

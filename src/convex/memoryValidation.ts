/**
 * Convex-compatible memory validation helpers.
 *
 * These run inside Convex mutation handlers before insert/update.
 * Mirrors the rules from src/lib/memory/validation.ts but without
 * external imports (Convex has its own tsconfig).
 */

const MIN_CONTENT_LENGTH = 10
const MAX_CONTENT_LENGTH = 500
const MIN_CONFIDENCE = 0.5
const MAX_CONFIDENCE = 1.0
const MIN_IMPORTANCE = 0.0
const MAX_IMPORTANCE = 1.0

type MemoryLayer = 'platform' | 'niche' | 'business' | 'agent'

const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(\+?1?\s*[-.]?\s*)?(\(?\d{3}\)?)\s*[-.]?\s*(\d{3})\s*[-.]?\s*(\d{4})\b/g,
  ssn: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g,
  creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  ipAddress: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
} as const

function redactPattern(content: string, pattern: RegExp, replacement: string): string {
  pattern.lastIndex = 0
  return content.replace(pattern, replacement)
}

export function containsPii(content: string): boolean {
  for (const pattern of Object.values(PII_PATTERNS)) {
    pattern.lastIndex = 0
    if (pattern.test(content)) {
      return true
    }
  }
  return false
}

export function redactPiiContent(content: string): string {
  let redacted = content
  redacted = redactPattern(redacted, PII_PATTERNS.email, '[REDACTED_EMAIL]')
  redacted = redactPattern(redacted, PII_PATTERNS.phone, '[REDACTED_PHONE]')
  redacted = redactPattern(redacted, PII_PATTERNS.ssn, '[REDACTED_SSN]')
  redacted = redactPattern(redacted, PII_PATTERNS.creditCard, '[REDACTED_CARD]')
  redacted = redactPattern(redacted, PII_PATTERNS.ipAddress, '[REDACTED_IP]')
  return redacted
}

export function applyMemoryLayerPiiPolicy(
  content: string,
  layer: MemoryLayer
): { content: string; redacted: boolean } {
  if (!containsPii(content)) {
    return { content, redacted: false }
  }

  if (layer === 'platform') {
    throw new Error('PII detected in platform memory content')
  }

  if (layer === 'niche' || layer === 'agent') {
    return {
      content: redactPiiContent(content),
      redacted: true,
    }
  }

  return { content, redacted: false }
}

export function validateBusinessMemoryInput(args: {
  content: string
  confidence: number
  importance: number
}): void {
  const errors: string[] = []
  const trimmed = args.content.trim().length

  if (trimmed < MIN_CONTENT_LENGTH) {
    errors.push(`Content too short: ${trimmed} chars (minimum ${MIN_CONTENT_LENGTH})`)
  }
  if (trimmed > MAX_CONTENT_LENGTH) {
    errors.push(`Content too long: ${trimmed} chars (maximum ${MAX_CONTENT_LENGTH})`)
  }
  if (args.confidence < MIN_CONFIDENCE || args.confidence > MAX_CONFIDENCE) {
    errors.push(`Confidence must be ${MIN_CONFIDENCE}–${MAX_CONFIDENCE}, got ${args.confidence}`)
  }
  if (args.importance < MIN_IMPORTANCE || args.importance > MAX_IMPORTANCE) {
    errors.push(`Importance must be ${MIN_IMPORTANCE}–${MAX_IMPORTANCE}, got ${args.importance}`)
  }

  if (errors.length > 0) {
    throw new Error(`Memory validation failed: ${errors.join('; ')}`)
  }
}

export function validateAgentMemoryInput(args: { content: string; confidence: number }): void {
  const errors: string[] = []
  const trimmed = args.content.trim().length

  if (trimmed < MIN_CONTENT_LENGTH) {
    errors.push(`Content too short: ${trimmed} chars (minimum ${MIN_CONTENT_LENGTH})`)
  }
  if (trimmed > MAX_CONTENT_LENGTH) {
    errors.push(`Content too long: ${trimmed} chars (maximum ${MAX_CONTENT_LENGTH})`)
  }
  if (args.confidence < MIN_CONFIDENCE || args.confidence > MAX_CONFIDENCE) {
    errors.push(`Confidence must be ${MIN_CONFIDENCE}–${MAX_CONFIDENCE}, got ${args.confidence}`)
  }

  if (errors.length > 0) {
    throw new Error(`Agent memory validation failed: ${errors.join('; ')}`)
  }
}

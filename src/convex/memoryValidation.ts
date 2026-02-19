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

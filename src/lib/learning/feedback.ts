import type {
  FeedbackRating,
  FeedbackSignalType,
  FeedbackSignalWeight,
  ImplicitSignalType,
  ScoreAdjustment,
} from '@/types'

/**
 * Feedback Signal Weights
 *
 * Explicit signals come from direct user actions (thumbs up/down, corrections).
 * Implicit signals are inferred from conversation flow patterns.
 */
export const SIGNAL_WEIGHTS: readonly FeedbackSignalWeight[] = [
  { type: 'thumbs_up', weight: 1.0, action: 'reinforce' },
  { type: 'thumbs_down', weight: -1.0, action: 'penalize' },
  { type: 'correction', weight: -0.5, action: 'update' },
  { type: 'instruction', weight: 2.0, action: 'create' },
  { type: 'follow_up_question', weight: -0.3, action: 'penalize' },
  { type: 'rephrase', weight: -0.2, action: 'penalize' },
  { type: 'task_complete', weight: 0.5, action: 'reinforce' },
  { type: 'tool_retry', weight: -0.4, action: 'penalize' },
] as const

const CONFIDENCE_DELTA_PER_UNIT = 0.05
const DECAY_DELTA_PER_UNIT = 0.1
const CONFIDENCE_MIN = 0.1
const CONFIDENCE_MAX = 1.0
const DECAY_MIN = 0.0
const DECAY_MAX = 1.0

const KEYWORD_OVERLAP_THRESHOLD = 0.6
const MIN_KEYWORD_LENGTH = 3

const COMPLETION_PATTERNS = [
  'thanks',
  'thank you',
  'that worked',
  'perfect',
  'great',
  'awesome',
  'exactly',
  'done',
  'got it',
  'that helps',
  'that did it',
  'wonderful',
  'brilliant',
  'nice',
  'looks good',
] as const

export function getSignalWeight(signalType: FeedbackSignalType): FeedbackSignalWeight | undefined {
  return SIGNAL_WEIGHTS.find((s) => s.type === signalType)
}

export function feedbackRatingToSignalType(rating: FeedbackRating): FeedbackSignalType {
  return rating === 'up' ? 'thumbs_up' : 'thumbs_down'
}

export function feedbackRatingToNumeric(rating: FeedbackRating): number {
  return rating === 'up' ? 5 : 1
}

export function computeScoreAdjustment(
  weight: number,
  _currentConfidence: number
): ScoreAdjustment {
  const direction = weight > 0 ? 1 : -1
  const magnitude = Math.abs(weight)
  return {
    confidenceDelta: direction * magnitude * CONFIDENCE_DELTA_PER_UNIT,
    decayScoreDelta: direction * magnitude * DECAY_DELTA_PER_UNIT,
  }
}

export function clampConfidence(value: number): number {
  return Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, value))
}

export function clampDecayScore(value: number): number {
  return Math.max(DECAY_MIN, Math.min(DECAY_MAX, value))
}

interface SimpleMessage {
  role: string
  content: string
  id?: string
}

function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= MIN_KEYWORD_LENGTH)
  return new Set(words)
}

function computeKeywordOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const word of a) {
    if (b.has(word)) intersection++
  }
  const smaller = Math.min(a.size, b.size)
  return smaller > 0 ? intersection / smaller : 0
}

function isQuestion(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.endsWith('?')) return true
  const lower = trimmed.toLowerCase()
  return /^(what|where|when|who|how|why|which|can|could|would|should|is|are|do|does|did)\b/.test(
    lower
  )
}

function hasToolFailure(messages: SimpleMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue
    const lower = msg.content.toLowerCase()
    if (
      lower.includes('error') ||
      lower.includes('failed') ||
      lower.includes("couldn't") ||
      lower.includes('unable to')
    ) {
      return true
    }
    break
  }
  return false
}

function isRephraseOf(current: string, previous: string): boolean {
  const currentKw = extractKeywords(current)
  const previousKw = extractKeywords(previous)
  return computeKeywordOverlap(currentKw, previousKw) >= KEYWORD_OVERLAP_THRESHOLD
}

function isCompletionMessage(text: string): boolean {
  const lower = text.toLowerCase().trim()
  return COMPLETION_PATTERNS.some((pattern) => lower.startsWith(pattern) || lower === pattern)
}

export interface DetectedImplicitSignal {
  type: ImplicitSignalType
  weight: number
  sourceMessageId?: string
}

/**
 * Detect implicit feedback signals from conversation flow.
 *
 * Analyzes the current user message in context of recent messages to infer
 * whether the user is satisfied, confused, or retrying after failure.
 */
export function detectImplicitSignals(
  currentMessage: SimpleMessage,
  previousMessages: SimpleMessage[]
): DetectedImplicitSignal[] {
  const signals: DetectedImplicitSignal[] = []
  const text = currentMessage.content.trim()
  if (!text) return signals

  if (isCompletionMessage(text)) {
    const w = getSignalWeight('task_complete')
    if (w) {
      signals.push({
        type: 'task_complete',
        weight: w.weight,
        sourceMessageId: currentMessage.id,
      })
    }
    return signals
  }

  const recentUserMessages = previousMessages.filter((m) => m.role === 'user').slice(-3)

  if (recentUserMessages.length > 0) {
    const lastUserMsg = recentUserMessages[recentUserMessages.length - 1]
    if (lastUserMsg && isRephraseOf(text, lastUserMsg.content)) {
      if (hasToolFailure(previousMessages)) {
        const w = getSignalWeight('tool_retry')
        if (w) {
          signals.push({
            type: 'tool_retry',
            weight: w.weight,
            sourceMessageId: currentMessage.id,
          })
        }
      } else {
        const w = getSignalWeight('rephrase')
        if (w) {
          signals.push({
            type: 'rephrase',
            weight: w.weight,
            sourceMessageId: currentMessage.id,
          })
        }
      }
      return signals
    }
  }

  let lastAssistantIdx = -1
  for (let i = previousMessages.length - 1; i >= 0; i--) {
    if (previousMessages[i].role === 'assistant') {
      lastAssistantIdx = i
      break
    }
  }
  if (lastAssistantIdx >= 0 && isQuestion(text)) {
    const turnsSinceAssistant = previousMessages.length - 1 - lastAssistantIdx
    if (turnsSinceAssistant <= 2) {
      const w = getSignalWeight('follow_up_question')
      if (w) {
        signals.push({
          type: 'follow_up_question',
          weight: w.weight,
          sourceMessageId: currentMessage.id,
        })
      }
    }
  }

  return signals
}

import type {
  DetectedPattern,
  PatternDetectionConfig,
  PatternDetectionResult,
  PatternType,
} from '../../types/learning'

const DEFAULT_CONFIG: PatternDetectionConfig = {
  minOccurrences: 5,
  timeWindowMs: 30 * 24 * 60 * 60 * 1000,
  confidenceThreshold: 0.8,
  autoLearnConfidence: 0.85,
  autoLearnMinOccurrences: 10,
}

export interface PatternEvent {
  type: string
  content: string
  timestamp: number
  metadata?: Record<string, unknown>
}

type PatternClassifier = (event: PatternEvent) => PatternType | null

const TIME_KEYWORDS = [
  'morning',
  'afternoon',
  'evening',
  'night',
  'weekday',
  'weekend',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'early',
  'late',
  'schedule',
  'time',
  'appointment',
] as const

const COMMUNICATION_KEYWORDS = [
  'email',
  'call',
  'text',
  'sms',
  'chat',
  'message',
  'phone',
  'formal',
  'casual',
  'brief',
  'detailed',
  'tone',
  'polite',
  'direct',
] as const

const DECISION_KEYWORDS = [
  'quick',
  'fast',
  'immediately',
  'asap',
  'later',
  'think',
  'consider',
  'deliberate',
  'decide',
  'wait',
  'take time',
  'rush',
] as const

const PRICE_KEYWORDS = [
  'price',
  'cost',
  'budget',
  'expensive',
  'cheap',
  'affordable',
  'discount',
  'deal',
  'value',
  'premium',
  'free',
  'pay',
  'worth',
  'invest',
] as const

const CHANNEL_KEYWORDS = [
  'instagram',
  'facebook',
  'twitter',
  'linkedin',
  'tiktok',
  'youtube',
  'website',
  'blog',
  'newsletter',
  'social',
  'online',
  'in-person',
  'referral',
] as const

function matchesKeywords(content: string, keywords: readonly string[]): boolean {
  const lower = content.toLowerCase()
  let matches = 0
  for (const kw of keywords) {
    if (lower.includes(kw)) matches++
  }
  return matches >= 2
}

const classifiers: PatternClassifier[] = [
  (event) => (matchesKeywords(event.content, TIME_KEYWORDS) ? 'time_preference' : null),
  (event) =>
    matchesKeywords(event.content, COMMUNICATION_KEYWORDS) ? 'communication_style' : null,
  (event) => (matchesKeywords(event.content, DECISION_KEYWORDS) ? 'decision_speed' : null),
  (event) => (matchesKeywords(event.content, PRICE_KEYWORDS) ? 'price_sensitivity' : null),
  (event) => (matchesKeywords(event.content, CHANNEL_KEYWORDS) ? 'channel_preference' : null),
]

export function classifyEvent(event: PatternEvent): PatternType | null {
  for (const classify of classifiers) {
    const result = classify(event)
    if (result) return result
  }
  return null
}

interface PatternAccumulator {
  type: PatternType
  occurrences: number
  confidence: number
  firstSeen: number
  lastSeen: number
  evidence: string[]
  descriptions: string[]
}

function buildDescription(type: PatternType, evidence: string[]): string {
  const prefix: Record<PatternType, string> = {
    time_preference: 'Prefers interactions during specific times',
    communication_style: 'Shows consistent communication preferences',
    decision_speed: 'Exhibits a characteristic decision-making pace',
    price_sensitivity: 'Demonstrates specific price/value sensitivity patterns',
    channel_preference: 'Prefers certain communication or marketing channels',
  }
  const base = prefix[type]
  if (evidence.length > 0) {
    const snippet = evidence[0].slice(0, 80)
    return `${base} — e.g. "${snippet}"`
  }
  return base
}

function computePatternConfidence(
  occurrences: number,
  timeSpanMs: number,
  windowMs: number
): number {
  const occurrenceScore = Math.min(occurrences / 10, 1.0)

  const recencyScore = timeSpanMs > 0 ? Math.max(0, 1 - timeSpanMs / (windowMs * 2)) : 0.5
  const frequencyBonus = occurrences >= 10 ? 0.1 : 0

  return Math.min(1.0, occurrenceScore * 0.6 + recencyScore * 0.3 + frequencyBonus + 0.1)
}

export function detectPatterns(
  events: PatternEvent[],
  existingPatterns: DetectedPattern[],
  config: Partial<PatternDetectionConfig> = {}
): PatternDetectionResult {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const cutoff = Date.now() - cfg.timeWindowMs
  const recentEvents = events.filter((e) => e.timestamp >= cutoff)

  const accumulators = new Map<PatternType, PatternAccumulator>()

  for (const existing of existingPatterns) {
    if (existing.lastSeen >= cutoff) {
      accumulators.set(existing.type, {
        type: existing.type,
        occurrences: existing.occurrences,
        confidence: existing.confidence,
        firstSeen: existing.firstSeen,
        lastSeen: existing.lastSeen,
        evidence: [...existing.evidence],
        descriptions: [existing.description],
      })
    }
  }

  for (const event of recentEvents) {
    const patternType = classifyEvent(event)
    if (!patternType) continue

    const existing = accumulators.get(patternType)
    if (existing) {
      existing.occurrences++
      existing.lastSeen = Math.max(existing.lastSeen, event.timestamp)
      existing.firstSeen = Math.min(existing.firstSeen, event.timestamp)
      if (existing.evidence.length < 5) {
        existing.evidence.push(event.content.slice(0, 120))
      }
    } else {
      accumulators.set(patternType, {
        type: patternType,
        occurrences: 1,
        confidence: 0,
        firstSeen: event.timestamp,
        lastSeen: event.timestamp,
        evidence: [event.content.slice(0, 120)],
        descriptions: [],
      })
    }
  }

  const patterns: DetectedPattern[] = []
  let newPatterns = 0
  let reinforcedPatterns = 0

  for (const acc of accumulators.values()) {
    if (acc.occurrences < cfg.minOccurrences) continue

    const timeSpan = acc.lastSeen - acc.firstSeen
    const confidence = computePatternConfidence(acc.occurrences, timeSpan, cfg.timeWindowMs)

    if (confidence < cfg.confidenceThreshold) continue

    const wasExisting = existingPatterns.some((p) => p.type === acc.type)
    if (wasExisting) {
      reinforcedPatterns++
    } else {
      newPatterns++
    }

    const autoLearned =
      confidence >= cfg.autoLearnConfidence && acc.occurrences >= cfg.autoLearnMinOccurrences

    patterns.push({
      type: acc.type,
      description: buildDescription(acc.type, acc.evidence),
      occurrences: acc.occurrences,
      confidence,
      firstSeen: acc.firstSeen,
      lastSeen: acc.lastSeen,
      autoLearned,
      evidence: acc.evidence.slice(0, 5),
    })
  }

  return {
    patterns,
    newPatterns,
    reinforcedPatterns,
    totalEventsAnalyzed: recentEvents.length,
  }
}

export function shouldAutoLearn(
  pattern: DetectedPattern,
  config: Partial<PatternDetectionConfig> = {}
): boolean {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  return (
    pattern.confidence >= cfg.autoLearnConfidence &&
    pattern.occurrences >= cfg.autoLearnMinOccurrences
  )
}

export function patternToMemoryContent(pattern: DetectedPattern): string {
  const evidenceStr =
    pattern.evidence.length > 0 ? ` Evidence: ${pattern.evidence.slice(0, 3).join('; ')}` : ''
  return `[Pattern:${pattern.type}] ${pattern.description} (confidence: ${pattern.confidence.toFixed(2)}, occurrences: ${pattern.occurrences}).${evidenceStr}`
}

export { DEFAULT_CONFIG as PATTERN_DETECTION_DEFAULTS }

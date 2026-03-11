import type {
  FailureCategory,
  FailureCheckResult,
  FailureLearningResult,
  FailureRecord,
} from '../../types/learning'

const FAILURE_CATEGORY_KEYWORDS: Record<FailureCategory, readonly string[]> = {
  tool_error: [
    'error',
    'failed',
    'exception',
    'timeout',
    'unavailable',
    'crash',
    'rejected',
    'unable to',
    'could not',
    'api error',
  ],
  misunderstanding: [
    'wrong',
    'not what i meant',
    'misunderstood',
    'confused',
    'incorrect interpretation',
    'that is not',
    "that's not",
    'no i meant',
    'i said',
    'actually',
  ],
  wrong_action: [
    'wrong action',
    'should not have',
    "shouldn't have",
    'undo',
    'revert',
    'cancel that',
    'not that one',
    'wrong one',
    'different',
    'other',
  ],
  incomplete_info: [
    'missing',
    'incomplete',
    'need more',
    'not enough',
    'also include',
    'forgot to',
    'what about',
    'you missed',
    'left out',
    'more detail',
  ],
} as const

const MIN_KEYWORD_MATCHES = 1
const SIMILARITY_THRESHOLD = 0.5
const MAX_PREVENTION_RULES = 10
const MAX_EVIDENCE_LENGTH = 200

export function classifyFailure(content: string): FailureCategory | null {
  const lower = content.toLowerCase()
  let bestCategory: FailureCategory | null = null
  let bestScore = 0

  for (const [category, keywords] of Object.entries(FAILURE_CATEGORY_KEYWORDS)) {
    let matches = 0
    for (const kw of keywords) {
      if (lower.includes(kw)) matches++
    }
    if (matches >= MIN_KEYWORD_MATCHES && matches > bestScore) {
      bestScore = matches
      bestCategory = category as FailureCategory
    }
  }

  return bestCategory
}

export function createFailureRecord(
  content: string,
  context: string,
  agentType: string,
  correction?: string
): FailureRecord | null {
  const category = classifyFailure(content)
  if (!category) return null

  const preventionRule = derivePreventionRule(category, content, correction)

  return {
    category,
    description: content.slice(0, MAX_EVIDENCE_LENGTH),
    context: context.slice(0, MAX_EVIDENCE_LENGTH),
    correction: correction?.slice(0, MAX_EVIDENCE_LENGTH),
    timestamp: Date.now(),
    agentType,
    preventionRule,
  }
}

function derivePreventionRule(
  category: FailureCategory,
  description: string,
  correction?: string
): string {
  const prefix: Record<FailureCategory, string> = {
    tool_error: 'Before retrying, verify tool availability and parameters.',
    misunderstanding: 'Clarify user intent before proceeding.',
    wrong_action: 'Confirm action with user before executing.',
    incomplete_info: 'Gather all required information before responding.',
  }

  const base = prefix[category]
  if (correction) {
    return `${base} Previous correction: "${correction.slice(0, 100)}"`
  }
  return `${base} Context: "${description.slice(0, 80)}"`
}

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length >= 3)
  )
}

function computeTextSimilarity(a: string, b: string): number {
  const kwA = extractKeywords(a)
  const kwB = extractKeywords(b)
  if (kwA.size === 0 || kwB.size === 0) return 0

  let intersection = 0
  for (const word of kwA) {
    if (kwB.has(word)) intersection++
  }
  const smaller = Math.min(kwA.size, kwB.size)
  return smaller > 0 ? intersection / smaller : 0
}

export function checkForRelevantFailures(
  context: string,
  pastFailures: FailureRecord[]
): FailureCheckResult {
  const relevant: FailureRecord[] = []
  const adviceSet = new Set<string>()

  for (const failure of pastFailures) {
    const contextSim = computeTextSimilarity(context, failure.context)
    const descSim = computeTextSimilarity(context, failure.description)
    const maxSim = Math.max(contextSim, descSim)

    if (maxSim >= SIMILARITY_THRESHOLD) {
      relevant.push(failure)
      if (failure.preventionRule) {
        adviceSet.add(failure.preventionRule)
      }
    }
  }

  return {
    hasRelevantFailures: relevant.length > 0,
    failures: relevant.slice(0, 5),
    preventionAdvice: [...adviceSet].slice(0, MAX_PREVENTION_RULES),
  }
}

export function failureToMemoryContent(record: FailureRecord): string {
  const parts = [`[Failure:${record.category}]`, record.description]
  if (record.correction) {
    parts.push(`Correction: ${record.correction}`)
  }
  if (record.preventionRule) {
    parts.push(`Prevention: ${record.preventionRule}`)
  }
  return parts.join(' — ')
}

export function processFailureBatch(
  events: Array<{ content: string; context: string; agentType: string; correction?: string }>,
  existingFailures: FailureRecord[]
): FailureLearningResult {
  let failuresRecorded = 0
  let correctionsApplied = 0
  let preventionRulesCreated = 0

  for (const event of events) {
    const record = createFailureRecord(
      event.content,
      event.context,
      event.agentType,
      event.correction
    )
    if (!record) continue

    const isDuplicate = existingFailures.some(
      (f) =>
        f.category === record.category &&
        computeTextSimilarity(f.description, record.description) >= 0.8
    )
    if (isDuplicate) continue

    failuresRecorded++
    if (record.correction) correctionsApplied++
    if (record.preventionRule) preventionRulesCreated++
    existingFailures.push(record)
  }

  return {
    failuresRecorded,
    correctionsApplied,
    preventionRulesCreated,
  }
}

export function formatPreventionContext(checkResult: FailureCheckResult): string {
  if (!checkResult.hasRelevantFailures) return ''

  const lines = ['⚠ Relevant past failures detected:']
  for (const f of checkResult.failures) {
    lines.push(`  - [${f.category}] ${f.description.slice(0, 100)}`)
  }
  if (checkResult.preventionAdvice.length > 0) {
    lines.push('Prevention advice:')
    for (const advice of checkResult.preventionAdvice) {
      lines.push(`  → ${advice}`)
    }
  }
  return lines.join('\n')
}

export { SIMILARITY_THRESHOLD, MAX_PREVENTION_RULES }

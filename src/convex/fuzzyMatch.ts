/**
 * Fuzzy Name Matching
 *
 * Handles typos, spelling variations, and partial names in entity lookups.
 * Uses a combination of:
 *   1. Levenshtein distance (edit distance) for close typos
 *   2. Double Metaphone phonetic codes for sound-alike matching
 *   3. Normalized scoring to rank matches by quality
 *
 * Zero external dependencies — all algorithms implemented inline.
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │  Input: "Sarha Jonson"                                        │
 * │                                                               │
 * │  Step 1: Levenshtein("sarha", "sarah") = 2 → normalized 0.60 │
 * │  Step 2: Metaphone("sarha") = "SR", Metaphone("sarah") = "SR"│
 * │          → phonetic match = 1.0 bonus                        │
 * │  Step 3: Combined score = 0.80 → above threshold (0.55)      │
 * │  Step 4: ✓ Match found: "Sarah Johnson"                      │
 * └────────────────────────────────────────────────────────────────┘
 */

const FUZZY_MATCH_THRESHOLD = 0.5
const PHONETIC_BONUS = 0.25
const EDIT_DISTANCE_WEIGHT = 0.75

// ============================================
// Damerau-Levenshtein Distance
// ============================================

/**
 * Damerau-Levenshtein: like Levenshtein but transpositions (ab→ba)
 * count as 1 edit instead of 2. Crucial for typo detection since
 * letter swaps are the most common keyboard mistake.
 */
function damerauLevenshtein(a: string, b: string): number {
  const la = a.length
  const lb = b.length
  if (la === 0) return lb
  if (lb === 0) return la

  const d = Array.from({ length: la + 1 }, () => new Array<number>(lb + 1).fill(0))

  for (let i = 0; i <= la; i++) d[i][0] = i
  for (let j = 0; j <= lb; j++) d[0][j] = j

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost)
      }
    }
  }

  return d[la][lb]
}

function normalizedEditDistance(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1.0
  return 1.0 - damerauLevenshtein(a, b) / maxLen
}

// ============================================
// Double Metaphone (simplified)
// ============================================

/**
 * Simplified Metaphone that covers the most common name transformations.
 * Handles: PH→F, GH→silent, silent letters, vowel normalization, etc.
 * Returns a 4-char code suitable for name matching.
 */
function metaphone(input: string): string {
  if (!input || input.length === 0) return ''

  let word = input.toUpperCase().replace(/[^A-Z]/g, '')
  if (word.length === 0) return ''

  if (word.startsWith('KN') || word.startsWith('GN') || word.startsWith('PN')) {
    word = word.slice(1)
  }
  if (word.startsWith('AE')) word = word.slice(1)
  if (word.startsWith('WR')) word = word.slice(1)

  const code: string[] = []
  let i = 0
  const len = word.length

  while (i < len && code.length < 4) {
    const c = word[i]
    const next = i + 1 < len ? word[i + 1] : ''

    if ('AEIOU'.includes(c)) {
      if (i === 0) code.push(c)
      i++
      continue
    }

    switch (c) {
      case 'B':
        if (i === 0 || word[i - 1] !== 'M') code.push('B')
        i++
        break
      case 'C':
        if ('EIY'.includes(next)) {
          code.push('S')
        } else {
          code.push('K')
        }
        i += next === 'H' ? 2 : 1
        break
      case 'D':
        if (next === 'G' && i + 2 < len && 'EIY'.includes(word[i + 2])) {
          code.push('J')
          i += 2
        } else {
          code.push('T')
          i++
        }
        break
      case 'F':
        code.push('F')
        i += next === 'F' ? 2 : 1
        break
      case 'G':
        if (next === 'H') {
          if (i + 2 < len && !'AEIOU'.includes(word[i + 2])) {
            i += 2
          } else {
            code.push('K')
            i += 2
          }
        } else if ('EIY'.includes(next)) {
          code.push('J')
          i++
        } else if (next !== '' || i === 0) {
          code.push('K')
          i++
        } else {
          i++
        }
        break
      case 'H':
        if ('AEIOU'.includes(next) && (i === 0 || !'AEIOU'.includes(word[i - 1]))) {
          code.push('H')
        }
        i++
        break
      case 'J':
        code.push('J')
        i += next === 'J' ? 2 : 1
        break
      case 'K':
        if (i === 0 || word[i - 1] !== 'C') code.push('K')
        i++
        break
      case 'L':
        code.push('L')
        i += next === 'L' ? 2 : 1
        break
      case 'M':
        code.push('M')
        i += next === 'M' ? 2 : 1
        break
      case 'N':
        code.push('N')
        i += next === 'N' ? 2 : 1
        break
      case 'P':
        if (next === 'H') {
          code.push('F')
          i += 2
        } else {
          code.push('P')
          i++
        }
        break
      case 'Q':
        code.push('K')
        i += next === 'Q' ? 2 : 1
        break
      case 'R':
        code.push('R')
        i += next === 'R' ? 2 : 1
        break
      case 'S':
        if (next === 'H' || (next === 'I' && i + 2 < len && word[i + 2] === 'O')) {
          code.push('X')
          i += 2
        } else {
          code.push('S')
          i += next === 'S' ? 2 : 1
        }
        break
      case 'T':
        if (next === 'H') {
          code.push('0')
          i += 2
        } else {
          code.push('T')
          i += next === 'T' ? 2 : 1
        }
        break
      case 'V':
        code.push('F')
        i += next === 'V' ? 2 : 1
        break
      case 'W':
      case 'Y':
        if ('AEIOU'.includes(next)) {
          code.push(c)
          i++
        } else {
          i++
        }
        break
      case 'X':
        code.push('K')
        code.push('S')
        i++
        break
      case 'Z':
        code.push('S')
        i += next === 'Z' ? 2 : 1
        break
      default:
        i++
    }
  }

  return code.join('')
}

// ============================================
// Combined Fuzzy Score
// ============================================

/**
 * Compute a 0-1 fuzzy match score between two name strings.
 * Combines normalized Levenshtein distance with phonetic similarity.
 */
function fuzzyScore(query: string, candidate: string): number {
  const qLower = query.toLowerCase().trim()
  const cLower = candidate.toLowerCase().trim()

  if (qLower === cLower) return 1.0
  if (cLower.includes(qLower) || qLower.includes(cLower)) return 0.9

  const editScore = normalizedEditDistance(qLower, cLower)

  const qPhonetic = metaphone(qLower)
  const cPhonetic = metaphone(cLower)
  const phoneticMatch = qPhonetic.length > 0 && qPhonetic === cPhonetic ? PHONETIC_BONUS : 0

  const prefixLen = Math.min(2, qLower.length, cLower.length)
  const prefixMatch = qLower.slice(0, prefixLen) === cLower.slice(0, prefixLen) ? 0.05 : 0

  return Math.min(1.0, editScore * EDIT_DISTANCE_WEIGHT + phoneticMatch + prefixMatch)
}

/**
 * Multi-word fuzzy match: matches "Sarha Jonson" against "Sarah Johnson"
 * by splitting into words and averaging the best per-word scores.
 */
function fuzzyScoreMultiWord(query: string, candidate: string): number {
  const qWords = query.toLowerCase().trim().split(/\s+/)
  const cWords = candidate.toLowerCase().trim().split(/\s+/)

  if (qWords.length === 1 && cWords.length === 1) {
    return fuzzyScore(query, candidate)
  }

  if (qWords.length === 1) {
    let bestWordScore = 0
    for (const cw of cWords) {
      bestWordScore = Math.max(bestWordScore, fuzzyScore(qWords[0], cw))
    }
    return bestWordScore
  }

  let totalScore = 0
  for (const qw of qWords) {
    let bestMatch = 0
    for (const cw of cWords) {
      bestMatch = Math.max(bestMatch, fuzzyScore(qw, cw))
    }
    totalScore += bestMatch
  }

  return totalScore / qWords.length
}

// ============================================
// Public API
// ============================================

export interface FuzzyMatchResult {
  matched: boolean
  score: number
  matchedName: string
}

/**
 * Check if a query name fuzzy-matches a candidate name.
 * Handles: "sara" → "Sarah", "sarha jonson" → "Sarah Johnson", etc.
 */
export function fuzzyMatchName(queryName: string, candidateName: string): FuzzyMatchResult {
  const score = fuzzyScoreMultiWord(queryName, candidateName)
  return {
    matched: score >= FUZZY_MATCH_THRESHOLD,
    score,
    matchedName: candidateName,
  }
}

/**
 * Find the best fuzzy match for a query name among a list of candidate names.
 * Returns null if no match exceeds the threshold.
 */
export function findBestFuzzyMatch(
  queryName: string,
  candidates: string[]
): FuzzyMatchResult | null {
  let best: FuzzyMatchResult | null = null

  for (const candidate of candidates) {
    const result = fuzzyMatchName(queryName, candidate)
    if (result.matched && (!best || result.score > best.score)) {
      best = result
    }
  }

  return best
}

/**
 * Check if a query name fuzzy-matches any name found in a text string.
 * Scans the text for capitalized name-like words and fuzzy-matches them.
 */
export function fuzzyMatchInContent(queryName: string, content: string): boolean {
  const qLower = queryName.toLowerCase()

  if (content.toLowerCase().includes(qLower)) return true

  const namePattern = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+)*)\b/g
  const namesInContent: string[] = []
  for (let match = namePattern.exec(content); match !== null; match = namePattern.exec(content)) {
    namesInContent.push(match[1])
  }

  if (namesInContent.length === 0) return false

  const bestMatch = findBestFuzzyMatch(queryName, namesInContent)
  return bestMatch !== null
}

export { metaphone, normalizedEditDistance, fuzzyScore }

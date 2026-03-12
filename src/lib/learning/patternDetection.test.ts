import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DetectedPattern } from '@/types'
import type { PatternEvent } from './patternDetection'
import {
  classifyEvent,
  detectPatterns,
  PATTERN_DETECTION_DEFAULTS,
  patternToMemoryContent,
  shouldAutoLearn,
} from './patternDetection'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(content: string, offsetMs = 0): PatternEvent {
  return { type: 'interaction', content, timestamp: Date.now() - offsetMs }
}

function makePattern(overrides: Partial<DetectedPattern> = {}): DetectedPattern {
  return {
    type: 'time_preference',
    description: 'test pattern',
    occurrences: 10,
    confidence: 0.9,
    firstSeen: Date.now() - 1000 * 60,
    lastSeen: Date.now(),
    autoLearned: false,
    evidence: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// classifyEvent
// ---------------------------------------------------------------------------

describe('classifyEvent', () => {
  it('returns time_preference for time-related keywords (>=2 matches)', () => {
    const event = makeEvent('I prefer morning appointments and schedule them early')
    assert.equal(classifyEvent(event), 'time_preference')
  })

  it('returns communication_style for communication keywords', () => {
    const event = makeEvent('I prefer formal email over casual phone calls')
    assert.equal(classifyEvent(event), 'communication_style')
  })

  it('returns decision_speed for decision keywords', () => {
    const event = makeEvent('I like to think carefully and deliberate before I decide')
    assert.equal(classifyEvent(event), 'decision_speed')
  })

  it('returns price_sensitivity for price keywords', () => {
    const event = makeEvent('The price is too expensive, I need an affordable deal')
    assert.equal(classifyEvent(event), 'price_sensitivity')
  })

  it('returns channel_preference for channel keywords', () => {
    const event = makeEvent('I mainly use instagram and facebook for social outreach')
    assert.equal(classifyEvent(event), 'channel_preference')
  })

  it('returns null when fewer than 2 keywords match', () => {
    const event = makeEvent('just a generic sentence with no relevant terms here')
    assert.equal(classifyEvent(event), null)
  })

  it('returns null for empty content', () => {
    const event = makeEvent('')
    assert.equal(classifyEvent(event), null)
  })

  it('is case-insensitive', () => {
    const event = makeEvent('MORNING SCHEDULE is important for my TIME')
    assert.equal(classifyEvent(event), 'time_preference')
  })
})

// ---------------------------------------------------------------------------
// detectPatterns
// ---------------------------------------------------------------------------

describe('detectPatterns', () => {
  it('returns empty result when no events provided', () => {
    const result = detectPatterns([], [])
    assert.equal(result.patterns.length, 0)
    assert.equal(result.newPatterns, 0)
    assert.equal(result.reinforcedPatterns, 0)
    assert.equal(result.totalEventsAnalyzed, 0)
  })

  it('does not emit a pattern below minOccurrences threshold', () => {
    // Default minOccurrences = 5; supply only 3 matching events
    const events = [
      makeEvent('I prefer morning schedule early'),
      makeEvent('My morning time appointments are early'),
      makeEvent('Schedule early morning time slots'),
    ]
    const result = detectPatterns(events, [], { minOccurrences: 5 })
    assert.equal(result.patterns.length, 0)
  })

  it('emits a new pattern when occurrences and confidence thresholds are met', () => {
    // Lower thresholds to make the test deterministic without needing many events
    const config = {
      minOccurrences: 3,
      confidenceThreshold: 0.5,
      autoLearnConfidence: 0.9,
      autoLearnMinOccurrences: 10,
    }
    // All events in the time window
    const events: PatternEvent[] = Array.from({ length: 3 }, (_, i) =>
      makeEvent('I prefer morning schedule early', i * 1000)
    )
    const result = detectPatterns(events, [], config)
    assert.ok(result.patterns.length >= 1, 'expected at least one pattern')
    assert.equal(result.newPatterns, result.patterns.length)
    assert.equal(result.reinforcedPatterns, 0)
  })

  it('counts reinforcedPatterns when existing pattern type is in input', () => {
    const config = {
      minOccurrences: 2,
      confidenceThreshold: 0.3,
      autoLearnConfidence: 0.95,
      autoLearnMinOccurrences: 100,
    }
    const existingPattern = makePattern({
      type: 'time_preference',
      occurrences: 5,
      confidence: 0.7,
    })
    const events: PatternEvent[] = Array.from({ length: 3 }, (_, i) =>
      makeEvent('I prefer morning schedule time', i * 1000)
    )
    const result = detectPatterns(events, [existingPattern], config)
    const tp = result.patterns.find((p) => p.type === 'time_preference')
    assert.ok(tp, 'time_preference pattern should be present')
    assert.ok(tp.occurrences > existingPattern.occurrences, 'occurrences should grow')
    assert.equal(result.reinforcedPatterns, 1)
    assert.equal(result.newPatterns, 0)
  })

  it('marks autoLearned=true when confidence and occurrences exceed auto-learn thresholds', () => {
    const config = {
      minOccurrences: 2,
      confidenceThreshold: 0.3,
      autoLearnConfidence: 0.5,
      autoLearnMinOccurrences: 3,
    }
    const events: PatternEvent[] = Array.from({ length: 5 }, (_, i) =>
      makeEvent('I prefer formal email tone over casual chat messages', i * 100)
    )
    const result = detectPatterns(events, [], config)
    const p = result.patterns.find((p) => p.type === 'communication_style')
    assert.ok(p, 'communication_style pattern should be present')
    assert.ok(p.autoLearned, 'should be auto-learned')
  })

  it('filters out events outside the time window', () => {
    const config = {
      minOccurrences: 2,
      timeWindowMs: 1000, // 1 second window
      confidenceThreshold: 0.3,
      autoLearnConfidence: 0.9,
      autoLearnMinOccurrences: 10,
    }
    // Events older than the window
    const events: PatternEvent[] = Array.from({ length: 5 }, (_, i) =>
      makeEvent('morning schedule time early appointment', 10_000 + i * 100)
    )
    const result = detectPatterns(events, [], config)
    assert.equal(result.totalEventsAnalyzed, 0)
    assert.equal(result.patterns.length, 0)
  })

  it('caps evidence at 5 entries per pattern', () => {
    const config = {
      minOccurrences: 5,
      confidenceThreshold: 0.4,
      autoLearnConfidence: 0.9,
      autoLearnMinOccurrences: 100,
    }
    const events: PatternEvent[] = Array.from({ length: 10 }, (_, i) =>
      makeEvent(`morning schedule time early appointment event-${i}`, i * 50)
    )
    const result = detectPatterns(events, [], config)
    const p = result.patterns.find((p) => p.type === 'time_preference')
    assert.ok(p, 'expected time_preference pattern')
    assert.ok(p.evidence.length <= 5, `evidence should be capped at 5, got ${p.evidence.length}`)
  })
})

// ---------------------------------------------------------------------------
// shouldAutoLearn
// ---------------------------------------------------------------------------

describe('shouldAutoLearn', () => {
  it('returns true when pattern exceeds both auto-learn thresholds', () => {
    const p = makePattern({
      confidence: PATTERN_DETECTION_DEFAULTS.autoLearnConfidence,
      occurrences: PATTERN_DETECTION_DEFAULTS.autoLearnMinOccurrences,
    })
    assert.ok(shouldAutoLearn(p))
  })

  it('returns false when confidence is below threshold', () => {
    const p = makePattern({
      confidence: PATTERN_DETECTION_DEFAULTS.autoLearnConfidence - 0.01,
      occurrences: PATTERN_DETECTION_DEFAULTS.autoLearnMinOccurrences,
    })
    assert.ok(!shouldAutoLearn(p))
  })

  it('returns false when occurrences is below threshold', () => {
    const p = makePattern({
      confidence: PATTERN_DETECTION_DEFAULTS.autoLearnConfidence,
      occurrences: PATTERN_DETECTION_DEFAULTS.autoLearnMinOccurrences - 1,
    })
    assert.ok(!shouldAutoLearn(p))
  })

  it('respects custom config overrides', () => {
    const p = makePattern({ confidence: 0.6, occurrences: 3 })
    assert.ok(shouldAutoLearn(p, { autoLearnConfidence: 0.5, autoLearnMinOccurrences: 3 }))
    assert.ok(!shouldAutoLearn(p, { autoLearnConfidence: 0.7, autoLearnMinOccurrences: 3 }))
  })
})

// ---------------------------------------------------------------------------
// patternToMemoryContent
// ---------------------------------------------------------------------------

describe('patternToMemoryContent', () => {
  it('produces a parseable string containing the pattern type, confidence and occurrences', () => {
    const p = makePattern({
      type: 'price_sensitivity',
      description: 'Demonstrates specific price/value sensitivity patterns',
      confidence: 0.92,
      occurrences: 12,
      evidence: ['loves discounts', 'wants free tier'],
    })
    const content = patternToMemoryContent(p)

    // Must be parseable by the fixed regexes in memoryExtraction.ts
    const typeMatch = content.match(/\[Pattern:(\w+)\]/)
    const occMatch = content.match(/occurrences: (\d+)/)
    const confMatch = content.match(/confidence: ([\d.]+)/)

    assert.ok(typeMatch, 'content should include [Pattern:<type>]')
    assert.equal(typeMatch[1], 'price_sensitivity')
    assert.ok(occMatch, 'content should include occurrences')
    assert.equal(parseInt(occMatch[1], 10), 12)
    assert.ok(confMatch, 'content should include confidence')
    assert.ok(Math.abs(parseFloat(confMatch[1]) - 0.92) < 0.01)
  })

  it('omits the Evidence suffix when evidence array is empty', () => {
    const p = makePattern({ evidence: [] })
    const content = patternToMemoryContent(p)
    assert.ok(!content.includes('Evidence:'))
  })

  it('includes evidence snippet when evidence is non-empty', () => {
    const p = makePattern({ evidence: ['user said morning works best'] })
    const content = patternToMemoryContent(p)
    assert.ok(content.includes('Evidence:'))
    assert.ok(content.includes('user said morning works best'))
  })

  it('round-trips through the memoryExtraction regex parser correctly', () => {
    // This test directly validates the interplay between patternToMemoryContent
    // and the fixed regex parser in memoryExtraction.ts.
    const p = makePattern({
      type: 'channel_preference',
      confidence: 0.75,
      occurrences: 7,
      evidence: [],
    })
    const content = patternToMemoryContent(p)
    const typeMatch = content.match(/\[Pattern:(\w+)\]/)
    const occMatch = content.match(/occurrences: (\d+)/)
    const confMatch = content.match(/confidence: ([\d.]+)/)

    assert.equal(typeMatch?.[1], 'channel_preference')
    assert.equal(parseInt(occMatch?.[1] ?? '0', 10), 7)
    assert.ok(Math.abs(parseFloat(confMatch?.[1] ?? '0') - 0.75) < 0.01)
  })
})

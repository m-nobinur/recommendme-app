export type PatternType =
  | 'time_preference'
  | 'communication_style'
  | 'decision_speed'
  | 'price_sensitivity'
  | 'channel_preference'

export interface DetectedPattern {
  type: PatternType
  description: string
  occurrences: number
  confidence: number
  firstSeen: number
  lastSeen: number
  autoLearned: boolean
  evidence: string[]
}

export interface PatternDetectionConfig {
  minOccurrences: number
  timeWindowMs: number
  confidenceThreshold: number
  autoLearnConfidence: number
  autoLearnMinOccurrences: number
}

export interface PatternDetectionResult {
  patterns: DetectedPattern[]
  newPatterns: number
  reinforcedPatterns: number
  totalEventsAnalyzed: number
}

export type FailureCategory = 'tool_error' | 'misunderstanding' | 'wrong_action' | 'incomplete_info'

export interface FailureRecord {
  category: FailureCategory
  description: string
  context: string
  correction?: string
  timestamp: number
  agentType: string
  preventionRule?: string
}

export interface FailureLearningResult {
  failuresRecorded: number
  correctionsApplied: number
  preventionRulesCreated: number
}

export interface FailureCheckResult {
  hasRelevantFailures: boolean
  failures: FailureRecord[]
  preventionAdvice: string[]
}

export type QualityMetricName =
  | 'relevance'
  | 'accuracy'
  | 'freshness'
  | 'retrieval_precision'
  | 'recall'

export interface QualityMetric {
  name: QualityMetricName
  value: number
  previousValue: number
  delta: number
  timestamp: number
}

export interface QualitySnapshot {
  organizationId: string
  metrics: QualityMetric[]
  overallScore: number
  alertTriggered: boolean
  alertReason?: string
  timestamp: number
}

export interface QualityAlert {
  metric: QualityMetricName
  currentValue: number
  previousValue: number
  dropPercent: number
  timestamp: number
}

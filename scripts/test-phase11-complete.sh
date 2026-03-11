#!/usr/bin/env bash
# ============================================================
# Phase 11: Continuous Improvement & Learning System
# Complete validation script (Phases 11.2–11.5)
#
# Static checks only — no live Convex server required.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

print_banner "Phase 11: Continuous Improvement & Learning (11.2–11.5)"

# ────────────────────────────────────────────────────────
# 1. File existence
# ────────────────────────────────────────────────────────
header "File Existence"

assert_file_exists "src/lib/learning/patternDetection.ts" "patternDetection.ts exists"
assert_file_exists "src/lib/learning/failureLearning.ts" "failureLearning.ts exists"
assert_file_exists "src/lib/learning/qualityMonitor.ts" "qualityMonitor.ts exists"
assert_file_exists "src/lib/learning/feedback.ts" "feedback.ts exists (Phase 11.1)"
assert_file_exists "src/convex/approvalQueue.ts" "approvalQueue.ts exists"
assert_file_exists "src/types/index.ts" "types/index.ts exists"

# ────────────────────────────────────────────────────────
# 2. Pattern Detection types (src/types/index.ts)
# ────────────────────────────────────────────────────────
header "Pattern Detection Types"

assert_file_contains "src/types/index.ts" "PatternType" "PatternType exported"
assert_file_contains "src/types/index.ts" "time_preference" "time_preference variant"
assert_file_contains "src/types/index.ts" "communication_style" "communication_style variant"
assert_file_contains "src/types/index.ts" "decision_speed" "decision_speed variant"
assert_file_contains "src/types/index.ts" "price_sensitivity" "price_sensitivity variant"
assert_file_contains "src/types/index.ts" "channel_preference" "channel_preference variant"
assert_file_contains "src/types/index.ts" "DetectedPattern" "DetectedPattern interface"
assert_file_contains "src/types/index.ts" "PatternDetectionConfig" "PatternDetectionConfig interface"
assert_file_contains "src/types/index.ts" "PatternDetectionResult" "PatternDetectionResult interface"
assert_file_contains "src/types/index.ts" "autoLearned" "autoLearned field in DetectedPattern"

# ────────────────────────────────────────────────────────
# 3. Failure Learning types
# ────────────────────────────────────────────────────────
header "Failure Learning Types"

assert_file_contains "src/types/index.ts" "FailureCategory" "FailureCategory exported"
assert_file_contains "src/types/index.ts" "tool_error" "tool_error category"
assert_file_contains "src/types/index.ts" "misunderstanding" "misunderstanding category"
assert_file_contains "src/types/index.ts" "wrong_action" "wrong_action category"
assert_file_contains "src/types/index.ts" "incomplete_info" "incomplete_info category"
assert_file_contains "src/types/index.ts" "FailureRecord" "FailureRecord interface"
assert_file_contains "src/types/index.ts" "FailureLearningResult" "FailureLearningResult interface"
assert_file_contains "src/types/index.ts" "FailureCheckResult" "FailureCheckResult interface"
assert_file_contains "src/types/index.ts" "preventionRule" "preventionRule field"

# ────────────────────────────────────────────────────────
# 4. Quality Monitor types
# ────────────────────────────────────────────────────────
header "Quality Monitor Types"

assert_file_contains "src/types/index.ts" "QualityMetricName" "QualityMetricName exported"
assert_file_contains "src/types/index.ts" "relevance" "relevance metric"
assert_file_contains "src/types/index.ts" "accuracy" "accuracy metric"
assert_file_contains "src/types/index.ts" "freshness" "freshness metric"
assert_file_contains "src/types/index.ts" "retrieval_precision" "retrieval_precision metric"
assert_file_contains "src/types/index.ts" "recall" "recall metric"
assert_file_contains "src/types/index.ts" "QualityMetric" "QualityMetric interface"
assert_file_contains "src/types/index.ts" "QualitySnapshot" "QualitySnapshot interface"
assert_file_contains "src/types/index.ts" "QualityAlert" "QualityAlert interface"
assert_file_contains "src/types/index.ts" "alertTriggered" "alertTriggered field"

# ────────────────────────────────────────────────────────
# 5. Pattern Detection module
# ────────────────────────────────────────────────────────
header "Pattern Detection Module (11.2)"

PD="src/lib/learning/patternDetection.ts"
assert_file_contains "$PD" "classifyEvent" "classifyEvent exported"
assert_file_contains "$PD" "detectPatterns" "detectPatterns exported"
assert_file_contains "$PD" "shouldAutoLearn" "shouldAutoLearn exported"
assert_file_contains "$PD" "patternToMemoryContent" "patternToMemoryContent exported"
assert_file_contains "$PD" "PATTERN_DETECTION_DEFAULTS" "PATTERN_DETECTION_DEFAULTS exported"
assert_file_contains "$PD" "minOccurrences: 5" "min occurrences = 5"
assert_file_contains "$PD" "confidenceThreshold: 0.8" "confidence threshold = 0.8"
assert_file_contains "$PD" "autoLearnConfidence: 0.85" "auto-learn confidence = 0.85"
assert_file_contains "$PD" "autoLearnMinOccurrences: 10" "auto-learn min occurrences = 10"
assert_file_contains "$PD" "30 \* 24 \* 60 \* 60 \* 1000" "30-day time window"

assert_file_contains "$PD" "TIME_KEYWORDS" "time preference keywords"
assert_file_contains "$PD" "COMMUNICATION_KEYWORDS" "communication style keywords"
assert_file_contains "$PD" "DECISION_KEYWORDS" "decision speed keywords"
assert_file_contains "$PD" "PRICE_KEYWORDS" "price sensitivity keywords"
assert_file_contains "$PD" "CHANNEL_KEYWORDS" "channel preference keywords"

assert_file_contains "$PD" "PatternEvent" "PatternEvent interface"
assert_file_contains "$PD" "computePatternConfidence" "computePatternConfidence function"
assert_file_contains "$PD" "buildDescription" "buildDescription function"

# ────────────────────────────────────────────────────────
# 6. Failure Learning module
# ────────────────────────────────────────────────────────
header "Failure Learning Module (11.3)"

FL="src/lib/learning/failureLearning.ts"
assert_file_contains "$FL" "classifyFailure" "classifyFailure exported"
assert_file_contains "$FL" "createFailureRecord" "createFailureRecord exported"
assert_file_contains "$FL" "checkForRelevantFailures" "checkForRelevantFailures exported"
assert_file_contains "$FL" "failureToMemoryContent" "failureToMemoryContent exported"
assert_file_contains "$FL" "processFailureBatch" "processFailureBatch exported"
assert_file_contains "$FL" "formatPreventionContext" "formatPreventionContext exported"
assert_file_contains "$FL" "SIMILARITY_THRESHOLD" "SIMILARITY_THRESHOLD exported"
assert_file_contains "$FL" "MAX_PREVENTION_RULES" "MAX_PREVENTION_RULES exported"

assert_file_contains "$FL" "FAILURE_CATEGORY_KEYWORDS" "failure category keyword map"
assert_file_contains "$FL" "derivePreventionRule" "derivePreventionRule helper"
assert_file_contains "$FL" "computeTextSimilarity" "text similarity computation"

assert_file_contains "$FL" "tool_error" "tool_error keywords defined"
assert_file_contains "$FL" "misunderstanding" "misunderstanding keywords defined"
assert_file_contains "$FL" "wrong_action" "wrong_action keywords defined"
assert_file_contains "$FL" "incomplete_info" "incomplete_info keywords defined"

assert_file_contains "$FL" "preventionRule" "prevention rules in failure records"
assert_file_contains "$FL" "preventionAdvice" "prevention advice in check results"

# ────────────────────────────────────────────────────────
# 7. Quality Monitor module
# ────────────────────────────────────────────────────────
header "Quality Monitor Module (11.4)"

QM="src/lib/learning/qualityMonitor.ts"
assert_file_contains "$QM" "computeRelevanceScore" "computeRelevanceScore exported"
assert_file_contains "$QM" "computeAccuracyScore" "computeAccuracyScore exported"
assert_file_contains "$QM" "computeFreshnessScore" "computeFreshnessScore exported"
assert_file_contains "$QM" "computeRetrievalPrecisionScore" "computeRetrievalPrecisionScore exported"
assert_file_contains "$QM" "computeRecallScore" "computeRecallScore exported"
assert_file_contains "$QM" "computeQualityMetrics" "computeQualityMetrics exported"
assert_file_contains "$QM" "computeOverallScore" "computeOverallScore exported"
assert_file_contains "$QM" "checkForAlerts" "checkForAlerts exported"
assert_file_contains "$QM" "createQualitySnapshot" "createQualitySnapshot exported"
assert_file_contains "$QM" "formatQualityReport" "formatQualityReport exported"

assert_file_contains "$QM" "ALERT_DROP_THRESHOLD_PERCENT" "alert threshold exported"
assert_file_contains "$QM" "ALERT_WINDOW_MS" "alert window exported"
assert_file_contains "$QM" "METRIC_WEIGHTS" "metric weights exported"

assert_file_contains "$QM" "MemoryStats" "MemoryStats interface"
assert_file_contains "$QM" "RetrievalStats" "RetrievalStats interface"
assert_file_contains "$QM" "totalActive" "totalActive in MemoryStats"
assert_file_contains "$QM" "avgConfidence" "avgConfidence in MemoryStats"
assert_file_contains "$QM" "staleCount" "staleCount in MemoryStats"

# Alert threshold check (10% drop)
if grep -q "10" "$QM" && grep -q "ALERT_DROP_THRESHOLD" "$QM"; then
  ok "10% drop alert threshold configured"
else
  err "Missing 10% alert threshold"
fi

# 24-hour window
assert_file_contains "$QM" "24 \* 60 \* 60 \* 1000" "24-hour alert window"

# ────────────────────────────────────────────────────────
# 8. Approval Learning (11.5)
# ────────────────────────────────────────────────────────
header "Approval Learning (11.5)"

AQ="src/convex/approvalQueue.ts"
assert_file_contains "$AQ" "emitApprovalLearningEvent" "emitApprovalLearningEvent helper"
assert_file_contains "$AQ" "approval_granted" "approval_granted event type"
assert_file_contains "$AQ" "approval_rejected" "approval_rejected event type"
assert_file_contains "$AQ" "memoryEvents" "memoryEvents insert from approval"
assert_file_contains "$AQ" "approval_learning:" "idempotency key prefix"
assert_file_contains "$AQ" "non-fatal" "non-fatal error handling"

# Check approve path calls emitApprovalLearningEvent
if grep -A30 "decision === 'approve'" "$AQ" | grep -q "emitApprovalLearningEvent" 2>/dev/null; then
  ok "Approve path emits learning event"
else
  err "Approve path does not emit learning event"
fi

# Check reject path calls emitApprovalLearningEvent
if grep -B2 -A20 "status: 'rejected'" "$AQ" | grep -q "emitApprovalLearningEvent" 2>/dev/null; then
  ok "Reject path emits learning event"
else
  err "Reject path does not emit learning event"
fi

# ────────────────────────────────────────────────────────
# 9. Cross-cutting: imports and integration
# ────────────────────────────────────────────────────────
header "Cross-cutting Checks"

assert_file_contains "$PD" "from '@/types'" "patternDetection imports from @/types"
assert_file_contains "$FL" "from '@/types'" "failureLearning imports from @/types"
assert_file_contains "$QM" "from '@/types'" "qualityMonitor imports from @/types"

assert_file_contains "$PD" "PatternDetectionConfig" "patternDetection uses config type"
assert_file_contains "$PD" "DetectedPattern" "patternDetection uses DetectedPattern type"
assert_file_contains "$FL" "FailureCategory" "failureLearning uses FailureCategory type"
assert_file_contains "$FL" "FailureRecord" "failureLearning uses FailureRecord type"
assert_file_contains "$QM" "QualityMetric" "qualityMonitor uses QualityMetric type"
assert_file_contains "$QM" "QualitySnapshot" "qualityMonitor uses QualitySnapshot type"

# ────────────────────────────────────────────────────────
# 10. Biome lint/format check
# ────────────────────────────────────────────────────────
header "Biome Lint & Format"

LINT_OUTPUT=$(bun run lint 2>&1)
if echo "$LINT_OUTPUT" | grep -q "No fixes applied"; then
  ok "Biome lint clean"
else
  err "Biome lint has issues"
fi

FORMAT_OUTPUT=$(bun run format:check 2>&1)
if echo "$FORMAT_OUTPUT" | grep -q "No fixes applied" && ! echo "$FORMAT_OUTPUT" | grep -q "Found.*errors"; then
  ok "Biome format clean"
else
  err "Biome format has issues"
fi

# ────────────────────────────────────────────────────────
# Results
# ────────────────────────────────────────────────────────
print_results
exit $fail

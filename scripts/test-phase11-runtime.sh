#!/usr/bin/env bash
# ============================================================
# Phase 11: Runtime Wiring Validation
# Validates pattern detection, failure learning, and quality
# monitoring are correctly wired into the Convex runtime.
#
# Static checks only — no live Convex server required.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

print_banner "Phase 11: Runtime Wiring (Pattern Detection, Failure Learning, Quality Monitor)"

# ────────────────────────────────────────────────────────
# 1. New files exist
# ────────────────────────────────────────────────────────
header "File Existence"

assert_file_exists "src/convex/learningPipeline.ts" "learningPipeline.ts exists"
assert_file_exists "src/convex/qualityMonitor.ts" "qualityMonitor.ts exists"
assert_file_exists "src/convex/crons.ts" "crons.ts exists"

# ────────────────────────────────────────────────────────
# 2. Schema: detectedPatterns table
# ────────────────────────────────────────────────────────
header "Schema: detectedPatterns Table"

SCH="src/convex/schema.ts"
assert_file_contains "$SCH" "detectedPatterns" "detectedPatterns table defined"
assert_file_contains "$SCH" "patternType" "patternType field"
assert_file_contains "$SCH" "time_preference" "time_preference enum value"
assert_file_contains "$SCH" "communication_style" "communication_style enum value"
assert_file_contains "$SCH" "decision_speed" "decision_speed enum value"
assert_file_contains "$SCH" "price_sensitivity" "price_sensitivity enum value"
assert_file_contains "$SCH" "channel_preference" "channel_preference enum value"
assert_file_contains "$SCH" "occurrenceCount" "occurrenceCount field"
assert_file_contains "$SCH" "autoLearned" "autoLearned field"
assert_file_contains "$SCH" "by_org_type" "by_org_type index"
assert_file_contains "$SCH" "by_org_active" "by_org_active index"

# ────────────────────────────────────────────────────────
# 3. Schema: qualitySnapshots table
# ────────────────────────────────────────────────────────
header "Schema: qualitySnapshots Table"

assert_file_contains "$SCH" "qualitySnapshots" "qualitySnapshots table defined"
assert_file_contains "$SCH" "overallScore" "overallScore field"
assert_file_contains "$SCH" "alertTriggered" "alertTriggered field"
assert_file_contains "$SCH" "alertReason" "alertReason field"

# ────────────────────────────────────────────────────────
# 4. Learning Pipeline: Pattern Detection
# ────────────────────────────────────────────────────────
header "Learning Pipeline: Pattern Detection (11.2)"

LP="src/convex/learningPipeline.ts"
assert_file_contains "$LP" "runPatternDetectionBatch" "runPatternDetectionBatch action"
assert_file_contains "$LP" "getExistingPatterns" "getExistingPatterns query"
assert_file_contains "$LP" "upsertDetectedPattern" "upsertDetectedPattern mutation"
assert_file_contains "$LP" "getRecentMessages" "getRecentMessages query"
assert_file_contains "$LP" "detectPatterns" "imports detectPatterns"
assert_file_contains "$LP" "shouldAutoLearn" "imports shouldAutoLearn"
assert_file_contains "$LP" "patternToMemoryContent" "imports patternToMemoryContent"
assert_file_contains "$LP" "insertAgentMemory" "creates agent memories for auto-learned patterns"

# ────────────────────────────────────────────────────────
# 5. Learning Pipeline: Failure Learning
# ────────────────────────────────────────────────────────
header "Learning Pipeline: Failure Learning (11.3)"

assert_file_contains "$LP" "runFailureLearningBatch" "runFailureLearningBatch action"
assert_file_contains "$LP" "getRecentToolFailureEvents" "getRecentToolFailureEvents query"
assert_file_contains "$LP" "getExistingFailureMemories" "getExistingFailureMemories query"
assert_file_contains "$LP" "createFailureRecord" "imports createFailureRecord"
assert_file_contains "$LP" "failureToMemoryContent" "imports failureToMemoryContent"
assert_file_contains "$LP" "applyMemoryLayerPiiPolicy" "PII policy applied"

# ────────────────────────────────────────────────────────
# 6. Quality Monitor: Snapshot Persistence
# ────────────────────────────────────────────────────────
header "Quality Monitor: Snapshot Persistence (11.4)"

QM="src/convex/qualityMonitor.ts"
assert_file_contains "$QM" "runQualityMonitorCheck" "runQualityMonitorCheck action"
assert_file_contains "$QM" "getPreviousQualitySnapshot" "loads previous snapshot for delta"
assert_file_contains "$QM" "insertQualitySnapshot" "persists quality snapshot"
assert_file_contains "$QM" "checkForAlerts" "imports checkForAlerts"

assert_file_contains "$LP" "insertQualitySnapshot" "insertQualitySnapshot mutation in pipeline"
assert_file_contains "$LP" "getPreviousQualitySnapshot" "getPreviousQualitySnapshot query in pipeline"

# ────────────────────────────────────────────────────────
# 7. Cron Entries
# ────────────────────────────────────────────────────────
header "Cron Entries"

CR="src/convex/crons.ts"
assert_file_contains "$CR" "pattern detection pipeline" "pattern detection cron entry"
assert_file_contains "$CR" "failure learning pipeline" "failure learning cron entry"
assert_file_contains "$CR" "memory quality monitor" "quality monitor cron entry"
assert_file_contains "$CR" "runPatternDetectionBatch" "cron references pattern detection action"
assert_file_contains "$CR" "runFailureLearningBatch" "cron references failure learning action"
assert_file_contains "$CR" "runQualityMonitorCheck" "cron references quality monitor action"

# ────────────────────────────────────────────────────────
# 8. Extraction Pipeline Hook
# ────────────────────────────────────────────────────────
header "Extraction Pipeline Hook"

ME="src/convex/memoryExtraction.ts"
assert_file_contains "$ME" "scheduleLearningAfterExtraction" "extraction schedules learning pipeline"
assert_file_contains "$ME" "learningPipeline" "memoryExtraction imports learningPipeline"

# ────────────────────────────────────────────────────────
# 9. Agent Runner: Failure Prevention in System Prompts
# ────────────────────────────────────────────────────────
header "Agent Runner: Failure Prevention Injection"

AR="src/convex/agentRunner.ts"
assert_file_contains "$AR" "buildFailurePreventionPrompt" "buildFailurePreventionPrompt helper"
assert_file_contains "$AR" "Known Issues to Avoid" "prevention context header"
assert_file_contains "$AR" "failureSuffix" "failureSuffix applied to system prompt"

if grep -c "failureSuffix" "$AR" | grep -q "4"; then
  ok "failureSuffix injected into all 4 agent types"
else
  SUFFIX_COUNT=$(grep -c "failureSuffix" "$AR")
  if [[ "$SUFFIX_COUNT" -ge 8 ]]; then
    ok "failureSuffix injected into all 4 agent types ($SUFFIX_COUNT references)"
  else
    err "failureSuffix should appear for all 4 agent types (found $SUFFIX_COUNT references)"
  fi
fi

assert_file_contains "$AR" "REMINDER_SYSTEM_PROMPT + failureSuffix" "reminder prompt includes prevention"
assert_file_contains "$AR" "INVOICE_SYSTEM_PROMPT + failureSuffix" "invoice prompt includes prevention"
assert_file_contains "$AR" "SALES_SYSTEM_PROMPT + failureSuffix" "sales prompt includes prevention"
assert_file_contains "$AR" "FOLLOWUP_SYSTEM_PROMPT + failureSuffix" "followup prompt includes prevention"

# ────────────────────────────────────────────────────────
# 10. Learning Pipeline: Scheduler Mutation
# ────────────────────────────────────────────────────────
header "Learning Pipeline: Post-Extraction Scheduling"

assert_file_contains "$LP" "scheduleLearningAfterExtraction" "scheduleLearningAfterExtraction mutation"
assert_file_contains "$LP" "ctx.scheduler.runAfter" "uses scheduler for async dispatch"

# ────────────────────────────────────────────────────────
# 11. Biome Lint & Format
# ────────────────────────────────────────────────────────
run_static_gate

# ────────────────────────────────────────────────────────
# Results
# ────────────────────────────────────────────────────────
print_results
exit $fail

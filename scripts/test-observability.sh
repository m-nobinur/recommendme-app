#!/usr/bin/env bash
# =============================================================================
# Observability / Cost Tracking (Phase 10a + 10b) – Validation Script
#
# Prerequisites:
#   1. Dependencies installed (`bun install`)
#   2. Convex + app code synced locally
#
# Manual QA checklist (after automated checks):
#   [ ] Run one chat request and confirm a `traces` row set is written for that request
#   [ ] Confirm corresponding `llmUsage` row is written with non-zero token counts
#   [ ] Trigger one agent run and confirm `llmUsage.purpose=agent` entries exist
#   [ ] Trigger memory extraction (`memoryExtraction:processExtractionBatch`) and confirm extraction usage is recorded
#   [ ] Query `traces.listByTrace` with wrong org/user and verify access is denied
#   [ ] Confirm trace/usage retention jobs schedule follow-up batches when backlog exceeds one run
#   [ ] Set org budget tier to `free`, exceed daily limit, verify chat returns HTTP 429 with Retry-After
#   [ ] Push org usage above warning threshold, verify chat auto-downgrades to cheaper model tier
#   [ ] Enable AI_ENABLE_LANGFUSE=true + keys, verify traces arrive in Langfuse ingestion
#   [ ] Verify memory context is ordered cache-friendly (platform+niche before business+agent)
# =============================================================================

set -uo pipefail

PASS=0
FAIL=0

check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Phase 10 Observability Validation ==="
echo ""

echo "── New Files ──"
check "src/lib/tracing/context.ts exists" test -f src/lib/tracing/context.ts
check "src/lib/tracing/spans.ts exists"   test -f src/lib/tracing/spans.ts
check "src/lib/tracing/index.ts exists"   test -f src/lib/tracing/index.ts
check "src/lib/tracing/langfuse.ts exists" test -f src/lib/tracing/langfuse.ts
check "src/lib/cost/pricing.ts exists"    test -f src/lib/cost/pricing.ts
check "src/lib/cost/budgets.ts exists"    test -f src/lib/cost/budgets.ts
check "src/lib/cost/manager.ts exists"    test -f src/lib/cost/manager.ts
check "src/convex/traces.ts exists"       test -f src/convex/traces.ts
check "src/convex/llmUsage.ts exists"     test -f src/convex/llmUsage.ts

echo ""
echo "── Schema Tables ──"
check "schema has traces table"    grep -q "traces: defineTable" src/convex/schema.ts
check "schema has llmUsage table"  grep -q "llmUsage: defineTable" src/convex/schema.ts
check "schema has approvalQueue"   grep -q "approvalQueue: defineTable" src/convex/schema.ts
check "schema has auditLogs"       grep -q "auditLogs: defineTable" src/convex/schema.ts
check "schema has org budgetTier setting" grep -q "budgetTier" src/convex/schema.ts

echo ""
echo "── Schema Indexes ──"
check "traces by_trace index"          grep -q "by_trace" src/convex/schema.ts
check "traces by_org_created index"    grep -q "by_org_created" src/convex/schema.ts
check "traces by_org_trace_start index" grep -q "by_org_trace_start" src/convex/schema.ts
check "llmUsage by_org_purpose index"  grep -q "by_org_purpose_created" src/convex/schema.ts

echo ""
echo "── Convex Module Exports ──"
check "traces.record export"            grep -q "export const record" src/convex/traces.ts
check "traces.recordBatch export"       grep -q "export const recordBatch" src/convex/traces.ts
check "traces.listByTrace export"       grep -q "export const listByTrace" src/convex/traces.ts
check "traces.listByOrg export"         grep -q "export const listByOrg" src/convex/traces.ts
check "traces.purgeOldTraces export"    grep -q "export const purgeOldTraces" src/convex/traces.ts
check "traces.listByTrace requires organizationId" grep -q "organizationId: v.id('organizations')" src/convex/traces.ts
check "traces reads enforce authenticated org access" grep -q "assertAuthenticatedUserInOrganization" src/convex/traces.ts
check "llmUsage.record export"          grep -q "export const record" src/convex/llmUsage.ts
check "llmUsage.getOrgUsage export"     grep -q "export const getOrgUsage" src/convex/llmUsage.ts
check "llmUsage.getOrgBudgetStatus"     grep -q "export const getOrgBudgetStatus" src/convex/llmUsage.ts
check "llmUsage.purgeOldUsage export"   grep -q "export const purgeOldUsage" src/convex/llmUsage.ts
check "llmUsage.getOrgBudgetStatus uses caller nowMs" grep -q "nowMs: v.number()" src/convex/llmUsage.ts
check "llmUsage reads enforce authenticated org access" grep -q "assertAuthenticatedUserInOrganization" src/convex/llmUsage.ts

echo ""
echo "── Tracing Infrastructure ──"
check "TraceContext class"       grep -q "class TraceContext" src/lib/tracing/context.ts
check "withSpan function"        grep -q "export async function withSpan" src/lib/tracing/spans.ts
check "barrel exports index"     grep -q "export.*TraceContext" src/lib/tracing/index.ts

echo ""
echo "── Cost Infrastructure ──"
check "estimateCost function"    grep -q "export function estimateCost" src/lib/cost/pricing.ts
check "checkBudget function"     grep -q "export function checkBudget" src/lib/cost/budgets.ts
check "evaluateBudgetRouting function" grep -q "export function evaluateBudgetRouting" src/lib/cost/manager.ts
check "MODEL_PRICING table"     grep -q "MODEL_PRICING" src/lib/cost/pricing.ts

echo ""
echo "── LLM Provider Instrumentation ──"
check "callLLMWithUsage export"  grep -q "export async function callLLMWithUsage" src/convex/llmProvider.ts
check "LLMUsageInfo interface"   grep -q "export interface LLMUsageInfo" src/convex/llmProvider.ts
check "extractUsageFromResponse" grep -q "extractUsageFromResponse" src/convex/llmProvider.ts

echo ""
echo "── Agent Runner Instrumentation ──"
check "agentRunner uses callLLMWithUsage" grep -q "callLLMWithUsage" src/convex/agentRunner.ts
check "agentRunner records llmUsage"      grep -q "internal.llmUsage.record" src/convex/agentRunner.ts

echo ""
echo "── Chat Route Instrumentation ──"
check "chat route imports TraceContext"    grep -q "TraceContext" src/app/api/chat/route.ts
check "chat route imports withSpan"        grep -q "withSpan" src/app/api/chat/route.ts
check "chat route records trace spans"     grep -q "recordSpans" src/app/api/chat/route.ts
check "chat route checks budget status"    grep -q "getOrgBudgetStatus" src/app/api/chat/route.ts
check "chat route returns 429 on budget exceed" grep -q "TOO_MANY_REQUESTS" src/app/api/chat/route.ts
check "chat route syncs to Langfuse"       grep -q "syncTraceToLangfuse" src/app/api/chat/route.ts

echo ""
echo "── Embedding Instrumentation ──"
check "embedding records llmUsage"         grep -q "internal.llmUsage.record" src/convex/embedding.ts

echo ""
echo "── Extraction Instrumentation ──"
check "extraction returns usage info"      grep -q "ExtractionLLMResult" src/convex/memoryExtraction.ts
check "extraction records llmUsage"        grep -q "internal.llmUsage.record" src/convex/memoryExtraction.ts

echo ""
echo "── Cron Jobs ──"
check "purge old traces cron"              grep -q "purge old traces" src/convex/crons.ts
check "purge old LLM usage cron"           grep -q "purge old LLM usage" src/convex/crons.ts
check "expire stale pending cron"          grep -q "expire stale pending" src/convex/crons.ts

echo ""
echo "── Unit Tests ──"
check "traces unit tests pass"             bun test src/convex/traces.test.ts
check "llmUsage unit tests pass"           bun test src/convex/llmUsage.test.ts
check "cost manager unit tests pass"       bun test src/lib/cost/manager.test.ts
check "context formatter tests pass"       bun test src/lib/ai/memory/contextFormatter.test.ts
check "langfuse batch tests pass"          bun test src/lib/tracing/langfuse.test.ts

echo ""
echo "══════════════════════════════════"
echo "  PASSED: $PASS  |  FAILED: $FAIL"
echo "══════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
echo "All checks passed!"

#!/usr/bin/env bash
# =============================================================================
# Sales Funnel Agent (Phase 7d) – Validation Script
#
# Prerequisites:
#   1. Convex dev server running: bun dev:convex
#   2. Next.js dev server running: bun dev:next
#   3. A test organization with leads in various pipeline stages
#
# Manual QA checklist (after automated checks):
#   [ ] Chat: "How hot is Sarah?" returns a 1-10 engagement score with reasoning
#   [ ] Chat: "Pipeline overview" returns stage counts, value, and stale leads
#   [ ] Chat: "What should I do with John?" returns actionable next steps
#   [ ] Update a lead status and verify event-triggered sales agent run
#   [ ] Verify daily sales funnel cron at 11:00 UTC in Convex dashboard
#   [ ] Confirm agent scores appear as [Sales Score ...] notes on leads
#   [ ] Confirm stale flags appear as [Stale Alert ...] notes on leads
#   [ ] Confirm stage recommendations appear as [Stage Recommendation ...] notes
#   [ ] Confirm cross-org pipeline reads are blocked by auth checks
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

print_banner "Phase 7d: Sales Funnel Agent"

header "Static Gates"
if bun run typecheck >/dev/null 2>&1; then
  ok "TypeScript compilation passes"
else
  err "TypeScript compilation failed"
fi

if bun run lint >/dev/null 2>&1; then
  ok "Lint passes"
else
  err "Lint failed"
fi

if bun run check:all >/dev/null 2>&1; then
  ok "Full validation gate passes (check:all)"
else
  err "Full validation gate failed (check:all)"
fi

header "File Wiring"
assert_file_exists "${ROOT_DIR}/src/convex/agentLogic/sales.ts" "Sales agent logic file exists"
assert_file_exists "${ROOT_DIR}/src/lib/ai/agents/sales/handler.ts" "Sales handler file exists"
assert_file_exists "${ROOT_DIR}/src/lib/ai/agents/sales/config.ts" "Sales config file exists"
assert_file_exists "${ROOT_DIR}/src/lib/ai/agents/sales/prompt.ts" "Sales prompt file exists"
assert_file_exists "${ROOT_DIR}/src/lib/ai/agents/sales/tools.ts" "Sales handler tools file exists"
assert_file_exists "${ROOT_DIR}/src/lib/ai/agents/sales/index.ts" "Sales barrel file exists"
assert_file_exists "${ROOT_DIR}/src/lib/ai/tools/salesFunnel.ts" "Sales funnel chat tools file exists"

header "Integration Checks – Chat Route & System Prompt"
assert_file_contains "${ROOT_DIR}/src/app/api/chat/route.ts" "createSalesFunnelTools" "Sales funnel tools wired in chat route"
assert_file_contains "${ROOT_DIR}/src/lib/ai/prompts/system.ts" "## Sales Pipeline" "System prompt includes sales pipeline guidance"
assert_file_contains "${ROOT_DIR}/src/lib/ai/prompts/system.ts" "getLeadScore" "System prompt mentions getLeadScore"
assert_file_contains "${ROOT_DIR}/src/lib/ai/prompts/system.ts" "getPipelineOverview" "System prompt mentions getPipelineOverview"
assert_file_contains "${ROOT_DIR}/src/lib/ai/prompts/system.ts" "getLeadRecommendation" "System prompt mentions getLeadRecommendation"

header "Integration Checks – Agent Framework"
assert_file_contains "${ROOT_DIR}/src/convex/crons.ts" "sales funnel agent" "Sales funnel cron registered"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "runSalesAgent" "Sales runner entry exists"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "runSalesAgentForLead" "Event trigger entry exists"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "getLeadsForSalesPipeline" "Pipeline query exists"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "getAppointmentsForLeads" "Appointments-for-leads query exists"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "getInvoicesForLeads" "Invoices-for-leads query exists"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "sanitizeSalesSettings" "Sales settings sanitizer exists"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "score_lead" "score_lead action handler present"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "recommend_stage_change" "recommend_stage_change action handler present"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "flag_stale_lead" "flag_stale_lead action handler present"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "log_pipeline_insight" "log_pipeline_insight action handler present"
assert_file_contains "${ROOT_DIR}/src/lib/ai/agents/registry.ts" "SalesHandler" "Sales handler registered"
assert_file_contains "${ROOT_DIR}/src/convex/leads.ts" "runSalesAgentForLead" "Lead status change triggers sales agent"

header "Integration Checks – Convex Logic"
assert_file_contains "${ROOT_DIR}/src/convex/agentLogic/sales.ts" "SALES_CONFIG" "Sales config constant defined"
assert_file_contains "${ROOT_DIR}/src/convex/agentLogic/sales.ts" "SALES_SYSTEM_PROMPT" "Sales system prompt defined"
assert_file_contains "${ROOT_DIR}/src/convex/agentLogic/sales.ts" "buildSalesUserPromptFromData" "Sales prompt builder defined"
assert_file_contains "${ROOT_DIR}/src/convex/agentLogic/sales.ts" "validateSalesPlan" "Sales plan validator defined"
assert_file_contains "${ROOT_DIR}/src/convex/agentLogic/sales.ts" "DEFAULT_SALES_SETTINGS" "Default sales settings defined"

header "Integration Checks – Tool Barrel"
assert_file_contains "${ROOT_DIR}/src/lib/ai/tools/index.ts" "createSalesFunnelTools" "Sales funnel tools exported from barrel"

header "Unit Tests"
assert_file_exists "${ROOT_DIR}/src/convex/agentLogic/sales.test.ts" "Sales agent logic unit tests exist"
assert_file_exists "${ROOT_DIR}/src/lib/ai/tools/salesFunnel.test.ts" "Sales chat tools unit tests exist"

if bun test "${ROOT_DIR}/src/convex/agentLogic/sales.test.ts" >/dev/null 2>&1; then
  ok "Sales agent logic unit tests pass"
else
  err "Sales agent logic unit tests failed"
fi

if bun test "${ROOT_DIR}/src/lib/ai/tools/salesFunnel.test.ts" >/dev/null 2>&1; then
  ok "Sales chat tool unit tests pass"
else
  err "Sales chat tool unit tests failed"
fi

header "Live Integration (optional — requires Convex dev server)"
if [ "${SKIP_LIVE:-}" = "true" ]; then
  ok "Skipped live tests (SKIP_LIVE=true)"
else
  CONVEX_URL="${NEXT_PUBLIC_CONVEX_URL:-}"
  if [ -z "${CONVEX_URL}" ]; then
    ok "Skipped live tests (NEXT_PUBLIC_CONVEX_URL not set)"
  else
    ok "Convex URL detected: ${CONVEX_URL}"
    echo "  Manual live smoke tests:"
    echo "    1. Chat: 'How hot is Sarah?' → expect 1-10 score with reasoning"
    echo "    2. Chat: 'Pipeline overview' → expect stage counts, value, stale count"
    echo "    3. Chat: 'What should I do with John?' → expect actionable next steps"
    echo "    4. Update a lead status in Convex dashboard → check logs for runSalesAgentForLead"
    echo "    5. Check cron schedule: sales funnel agent at 11:00 UTC"
  fi
fi

print_results
exit $fail

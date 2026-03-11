#!/usr/bin/env bash
# =============================================================================
# Feedback Learning Loop (Phase 11 slice) – Validation Script
#
# Prerequisites:
#   1. Dependencies installed (`bun install`)
#   2. Optional live checks: Convex + Next dev servers running
#
# Manual QA checklist:
#   [ ] Send a chat message and confirm thumbs up/down controls appear on assistant reply
#   [ ] Submit thumbs up and confirm selection locks for that message
#   [ ] Submit thumbs down on another assistant reply and confirm rollback on network error
#   [ ] Confirm `/api/feedback` returns 401 for unauthenticated users
#   [ ] Burst feedback submissions (>20/min) and confirm 429 + Retry-After
#   [ ] Approve and reject real queue items, then verify memoryEvents get approval_granted/rejected
#   [ ] Trigger extraction and verify confidence/decay adjustments happen once per event
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

print_banner "Phase 11: Feedback Learning Loop"

header "Static Gates"
run_static_gate

header "Feature Wiring"
assert_file_exists "${ROOT_DIR}/src/app/api/feedback/route.ts" "feedback API route exists"
assert_file_exists "${ROOT_DIR}/src/convex/feedback.ts" "feedback Convex module exists"
assert_file_exists "${ROOT_DIR}/src/lib/learning/feedback.ts" "learning feedback utility exists"
assert_file_contains "${ROOT_DIR}/src/components/chat/MessageBubble.tsx" "FeedbackButtons" \
  "message bubble renders feedback controls"
assert_file_contains "${ROOT_DIR}/src/app/(dashboard)/chat/components/ChatContainer.tsx" \
  "fetch('/api/feedback'" "chat container posts feedback to API route"
assert_file_contains "${ROOT_DIR}/src/app/api/chat/route.ts" "detectImplicitSignals" \
  "chat route emits implicit feedback memory signals"
assert_file_contains "${ROOT_DIR}/src/app/api/feedback/route.ts" "checkSecurityRateLimitDistributed" \
  "feedback route uses distributed rate limiting"
assert_file_contains "${ROOT_DIR}/src/app/api/feedback/route.ts" "Cannot submit feedback for another user message" \
  "feedback route enforces message ownership"
assert_file_contains "${ROOT_DIR}/src/app/api/feedback/route.ts" "Feedback is only allowed on assistant messages" \
  "feedback route rejects non-assistant message targets"
assert_file_contains "${ROOT_DIR}/src/convex/messages.ts" "getByMessageId" \
  "messages query exposes targeted message lookup for feedback validation"
assert_file_contains "${ROOT_DIR}/src/convex/approvalQueue.ts" "emitApprovalLearningEvent" \
  "approval queue emits learning events on decisions"
assert_file_contains "${ROOT_DIR}/src/convex/memoryExtraction.ts" "adjustFeedbackScores" \
  "memory extraction applies feedback-based score updates"

header "Targeted Tests"
if bun test "${ROOT_DIR}/src/lib/learning/feedback.test.ts" >/dev/null 2>&1; then
  ok "learning feedback unit tests pass"
else
  err "learning feedback unit tests failed"
fi

if bun test "${ROOT_DIR}/src/convex/feedback.test.ts" >/dev/null 2>&1; then
  ok "convex feedback unit tests pass"
else
  err "convex feedback unit tests failed"
fi

if bun test "${ROOT_DIR}/src/convex/approvalQueue.test.ts" >/dev/null 2>&1; then
  ok "approval queue unit tests pass"
else
  err "approval queue unit tests failed"
fi

header "Optional Live Probe"
if [[ -z "${ORG_ID}" ]]; then
  skip "Live probe (set ORG_ID in .env.local)"
else
  PROBE_OUT=$(npx convex run memoryEvents:listByType \
    "{\"organizationId\":\"${ORG_ID}\",\"eventType\":\"feedback\",\"processedOnly\":false,\"limit\":3}" \
    2>&1 || true)
  if echo "$PROBE_OUT" | rg -qi "error"; then
    warn "Live probe returned error (check dev server/token/env)"
  else
    ok "Live memoryEvents:listByType(feedback) probe succeeded"
  fi
fi

print_results
exit $fail

#!/usr/bin/env bash
# =============================================================================
# Approval Workflow (Phase 9 core) – Validation Script
#
# Prerequisites:
#   1. Convex dev server running: bun dev:convex
#   2. Next.js dev server running: bun dev:next
#
# Manual QA checklist (after automated checks):
#   [ ] Send a message containing "ignore all previous instructions" and confirm 400 response
#   [ ] Send a normal message and confirm it processes successfully
#   [ ] Trigger an agent run that produces high-risk actions
#   [ ] Verify approval queue records are created with pending status + expiry
#   [ ] Use chat: "list pending approvals" and confirm returned queue IDs
#   [ ] Approve one queue item and verify status moves to approved
#   [ ] Reject one queue item and verify rejectionReason is saved
#   [ ] Verify audit logs contain queue + completion events for the execution
#   [ ] Wait 30+ minutes and verify approval expiration cron runs
#   [ ] Sign up a new user and confirm a dedicated org is created (no shared default org)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

DEV_USER_ID=""
if [[ -f "$ENV_FILE" ]]; then
  DEV_USER_ID=$(grep -E '^DEV_USER_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
fi

print_banner "Phase 9: Approval Queue + Audit Logging"

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

header "Schema + Backend Wiring"
assert_file_contains "${ROOT_DIR}/src/convex/schema.ts" "approvalQueue:" \
  "approvalQueue table exists in schema"
assert_file_contains "${ROOT_DIR}/src/convex/schema.ts" "auditLogs:" \
  "auditLogs table exists in schema"
assert_file_exists "${ROOT_DIR}/src/convex/approvalQueue.ts" \
  "approvalQueue module exists"
assert_file_exists "${ROOT_DIR}/src/convex/auditLogs.ts" \
  "auditLogs module exists"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "approvalQueue.enqueueBatch" \
  "agentRunner enqueues approval-required actions"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "executeApprovedQueueItem" \
  "agentRunner can execute approved queue items"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "reconcileExecutionAfterApprovalDecision" \
  "agentRunner reconciles execution after approval decisions"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "auditLogs.appendBatch" \
  "agentRunner writes pre-execution audit logs"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "approvalQueueItemIds" \
  "agentRunner returns queued approval metadata"
assert_file_contains "${ROOT_DIR}/src/convex/auth.ts" "createOrganizationForSignup" \
  "auth bootstrap uses per-user org creation helper"

header "Input Validation Layer"
assert_file_exists "${ROOT_DIR}/src/lib/security/inputValidation.ts" \
  "inputValidation module exists"
assert_file_contains "${ROOT_DIR}/src/lib/security/inputValidation.ts" "validateChatInput" \
  "validateChatInput function exported"
assert_file_contains "${ROOT_DIR}/src/lib/security/inputValidation.ts" "validateMessagesInput" \
  "validateMessagesInput function exported"
assert_file_contains "${ROOT_DIR}/src/app/api/chat/route.ts" "validateMessagesInput" \
  "chat route validates all user messages"
assert_file_contains "${ROOT_DIR}/src/app/api/chat/route.ts" "sanitizeForLogging" \
  "chat route uses sanitizeForLogging for threat logging"

header "Chat Tool Wiring"
assert_file_exists "${ROOT_DIR}/src/lib/ai/tools/approval.ts" \
  "approval tools module exists"
assert_file_contains "${ROOT_DIR}/src/lib/ai/tools/index.ts" "createApprovalTools" \
  "approval tools exported in barrel"
assert_file_contains "${ROOT_DIR}/src/app/api/chat/route.ts" "createApprovalTools" \
  "approval tools wired into chat route"
assert_file_contains "${ROOT_DIR}/src/lib/ai/prompts/system.ts" "listPendingApprovals" \
  "system prompt documents approval workflow"

header "Notification API Wiring"
assert_file_exists "${ROOT_DIR}/src/app/api/approvals/route.ts" \
  "approval notification API route exists"
assert_file_contains "${ROOT_DIR}/src/app/(dashboard)/components/DashboardShell.tsx" "/api/approvals" \
  "dashboard notifications use server approval API"

header "Cron Scheduling"
assert_file_contains "${ROOT_DIR}/src/convex/crons.ts" "expireStalePending" \
  "approval expiration cron is scheduled"

header "Targeted Unit Tests"
if bun test "${ROOT_DIR}/src/lib/security/inputValidation.test.ts" >/dev/null 2>&1; then
  ok "inputValidation unit tests pass"
else
  err "inputValidation unit tests failed"
fi

if bun test "${ROOT_DIR}/src/convex/approvalQueue.test.ts" >/dev/null 2>&1; then
  ok "approvalQueue unit tests pass"
else
  err "approvalQueue unit tests failed"
fi

if bun test "${ROOT_DIR}/src/convex/agentRunner.approval.test.ts" >/dev/null 2>&1; then
  ok "agentRunner approval lifecycle tests pass"
else
  err "agentRunner approval lifecycle tests failed"
fi

if bun test "${ROOT_DIR}/src/lib/ai/tools/approval.test.ts" >/dev/null 2>&1; then
  ok "approval tools unit tests pass"
else
  err "approval tools unit tests failed"
fi

if bun test "${ROOT_DIR}/src/convex/agentRunner.reminder.test.ts" >/dev/null 2>&1; then
  ok "agentRunner reminder tests pass (queue metadata assertions included)"
else
  err "agentRunner reminder tests failed"
fi

header "Live Convex Probe (optional)"
if [[ -z "$ORG_ID" ]] || [[ -z "$DEV_USER_ID" ]]; then
  skip "Live probe (need DEV_ORGANIZATION_ID + DEV_USER_ID in .env.local)"
else
  NOW_MS="$(( $(date +%s) * 1000 ))"
  AUTH_TOKEN_JSON=""
  if [[ -n "$MEMORY_API_TOKEN" ]]; then
    AUTH_TOKEN_JSON=", \"authToken\": \"${MEMORY_API_TOKEN}\""
  fi
  LIVE_OUTPUT=$(npx convex run approvalQueue:listPending \
    "{\"userId\": \"${DEV_USER_ID}\", \"organizationId\": \"${ORG_ID}\", \"limit\": 5, \"now\": ${NOW_MS}${AUTH_TOKEN_JSON}}" 2>&1 || true)
  if echo "$LIVE_OUTPUT" | grep -qi "error"; then
    warn "Live probe returned an error (this can happen if DEV_USER_ID lacks owner/admin role)"
  else
    ok "Live approvalQueue:listPending probe succeeded"
  fi
fi

print_results
exit $fail

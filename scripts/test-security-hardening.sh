#!/usr/bin/env bash
# =============================================================================
# Security Hardening (Phase 9) – Validation Script
#
# Prerequisites:
#   1. Dependencies installed (`bun install`)
#   2. Optional live checks: Convex dev server running (`bun dev:convex`)
#
# Manual QA checklist (after automated checks):
#   [ ] Send repeated POST /api/chat requests and verify 429 + Retry-After appears
#   [ ] Trigger POST /api/approvals rapidly as owner/admin and verify 429 + Retry-After
#   [ ] Attempt approval review as non-admin role and verify 403 + security audit event
#   [ ] Cause org-mismatch access attempt and verify tenant isolation security event is logged
#   [ ] Create platform memory with PII and verify mutation rejects with validation error
#   [ ] Create niche/agent memory with PII and verify stored content is redacted
#   [ ] Create business memory with PII and verify content is accepted unchanged
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

DEV_USER_ID=""
if [[ -f "$ENV_FILE" ]]; then
  DEV_USER_ID=$(grep -E '^DEV_USER_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
fi

print_banner "Phase 9: Security Hardening Validation"

header "Static Gates"
run_static_gate

header "Targeted Security Unit Tests"
if bun test "${ROOT_DIR}/src/lib/security/rateLimiting.test.ts" >/dev/null 2>&1; then
  ok "rateLimiting unit tests pass"
else
  err "rateLimiting unit tests failed"
fi

if bun test "${ROOT_DIR}/src/lib/security/pii.test.ts" >/dev/null 2>&1; then
  ok "pii unit tests pass"
else
  err "pii unit tests failed"
fi

if bun test "${ROOT_DIR}/src/lib/security/tenantIsolation.test.ts" >/dev/null 2>&1; then
  ok "tenantIsolation unit tests pass"
else
  err "tenantIsolation unit tests failed"
fi

if bun test "${ROOT_DIR}/src/convex/memoryValidation.test.ts" >/dev/null 2>&1; then
  ok "convex memoryValidation unit tests pass"
else
  err "convex memoryValidation unit tests failed"
fi

if bun test "${ROOT_DIR}/src/convex/memoryExtraction.test.ts" >/dev/null 2>&1; then
  ok "convex memoryExtraction security tests pass"
else
  err "convex memoryExtraction security tests failed"
fi

if bun test "${ROOT_DIR}/src/convex/agentRunner.security.test.ts" >/dev/null 2>&1; then
  ok "convex agentRunner security tests pass"
else
  err "convex agentRunner security tests failed"
fi

if bun test "${ROOT_DIR}/src/convex/security.test.ts" >/dev/null 2>&1; then
  ok "convex distributed rate limit tests pass"
else
  err "convex distributed rate limit tests failed"
fi

if bun test "${ROOT_DIR}/src/convex/auditLogs.test.ts" >/dev/null 2>&1; then
  ok "auditLogs unit tests pass"
else
  err "auditLogs unit tests failed"
fi

header "Security Wiring Checks"
assert_file_exists "${ROOT_DIR}/src/lib/security/rateLimiting.ts" "security rate limiting module exists"
assert_file_exists "${ROOT_DIR}/src/lib/security/pii.ts" "security PII module exists"
assert_file_exists "${ROOT_DIR}/src/lib/security/tenantIsolation.ts" "tenant isolation helper exists"

assert_file_contains "${ROOT_DIR}/src/app/api/chat/route.ts" "checkSecurityRateLimit" \
  "chat route enforces security rate limiting"
assert_file_contains "${ROOT_DIR}/src/app/api/chat/route.ts" "checkSecurityRateLimitDistributed" \
  "chat route uses distributed security rate limiting"
assert_file_contains "${ROOT_DIR}/src/app/api/chat/route.ts" "recordSecurityEvent" \
  "chat route records security audit events"
assert_file_contains "${ROOT_DIR}/src/app/api/approvals/route.ts" "checkSecurityRateLimit" \
  "approvals route enforces review rate limiting"
assert_file_contains "${ROOT_DIR}/src/app/api/approvals/route.ts" "checkSecurityRateLimitDistributed" \
  "approvals route uses distributed review rate limiting"
assert_file_contains "${ROOT_DIR}/src/app/api/approvals/route.ts" "approval.review.forbidden_role" \
  "approvals route logs forbidden review attempts"
assert_file_contains "${ROOT_DIR}/src/app/api/approvals/route.ts" "approval.review.rate_limited" \
  "approvals route logs rate-limited review attempts"

assert_file_contains "${ROOT_DIR}/src/convex/auditLogs.ts" "recordSecurityEvent" \
  "auditLogs has server-callable security event mutation"
assert_file_contains "${ROOT_DIR}/src/convex/security.ts" "consumeRateLimit" \
  "convex security module has distributed rate-limit mutation"
assert_file_contains "${ROOT_DIR}/src/convex/memoryValidation.ts" "applyMemoryLayerPiiPolicy" \
  "convex memory validation exposes PII policy helper"
assert_file_contains "${ROOT_DIR}/src/convex/platformMemories.ts" "applyMemoryLayerPiiPolicy" \
  "platform memory enforces PII blocking policy"
assert_file_contains "${ROOT_DIR}/src/convex/nicheMemories.ts" "applyMemoryLayerPiiPolicy" \
  "niche memory enforces PII redaction policy"
assert_file_contains "${ROOT_DIR}/src/convex/agentMemories.ts" "applyMemoryLayerPiiPolicy" \
  "agent memory enforces PII redaction policy"
assert_file_contains "${ROOT_DIR}/src/convex/businessMemories.ts" "applyMemoryLayerPiiPolicy" \
  "business memory applies explicit allow policy for PII"

header "Optional Live Convex Probe"
if [[ -z "$ORG_ID" ]] || [[ -z "$DEV_USER_ID" ]]; then
  skip "Live security probe (need DEV_ORGANIZATION_ID + DEV_USER_ID in .env.local)"
else
  PROBE_OUT=$(npx convex run auditLogs:list \
    "{\"userId\": \"${DEV_USER_ID}\", \"organizationId\": \"${ORG_ID}\", \"limit\": 5}" 2>&1 || true)

  if echo "$PROBE_OUT" | grep -qi "error"; then
    warn "Live auditLogs:list probe returned error (verify dev role/server state)"
  else
    ok "Live auditLogs:list probe succeeded"
  fi
fi

print_results
exit $fail

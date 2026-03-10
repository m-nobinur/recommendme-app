#!/usr/bin/env bash
# =============================================================================
# Invoice Agent (Phase 7c) – Validation Script
#
# Prerequisites:
#   1. Convex dev server running: bun dev:convex
#   2. Next.js dev server running: bun dev:next
#   3. A test organization with at least one lead and one completed appointment
#
# Manual QA checklist (after automated checks):
#   [ ] Chat: "Invoice Sarah $500 for portrait session" creates a draft invoice
#   [ ] Chat: "Show my invoices" lists invoices with status
#   [ ] Chat: "What's my billing summary?" returns aggregate stats
#   [ ] Chat: "Mark Sarah's invoice as paid" updates invoice status to paid
#   [ ] Mark an appointment completed and verify event-triggered invoice run
#   [ ] Verify daily invoice cron at 10:00 UTC is present in Convex dashboard
#   [ ] Confirm cross-org invoice reads/writes are blocked by auth checks
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

print_banner "Phase 7c: Invoice Agent"

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

header "Unit Tests"
if bun test "${ROOT_DIR}/src/lib/ai/tools/invoice.test.ts" >/dev/null 2>&1; then
  ok "Invoice chat tools tests pass"
else
  err "Invoice chat tools tests failed"
fi

if bun test "${ROOT_DIR}/src/convex/agentLogic/invoice.test.ts" >/dev/null 2>&1; then
  ok "Invoice agent logic tests pass"
else
  err "Invoice agent logic tests failed"
fi

if bun test "${ROOT_DIR}/src/convex/invoices.test.ts" >/dev/null 2>&1; then
  ok "Convex invoice function tests pass"
else
  err "Convex invoice function tests failed"
fi

if bun test "${ROOT_DIR}/src/convex/agentRunner.reminder.test.ts" >/dev/null 2>&1; then
  ok "Agent runner regression tests pass"
else
  err "Agent runner regression tests failed"
fi

header "File Wiring"
assert_file_exists "${ROOT_DIR}/src/convex/agentLogic/invoice.ts" "Invoice logic file exists"
assert_file_exists "${ROOT_DIR}/src/lib/ai/agents/invoice/handler.ts" "Invoice handler file exists"
assert_file_exists "${ROOT_DIR}/src/lib/ai/tools/invoice.ts" "Invoice chat tools file exists"
assert_file_exists "${ROOT_DIR}/src/lib/ai/tools/invoice.test.ts" "Invoice chat tools test exists"

header "Integration Checks"
assert_file_contains "${ROOT_DIR}/src/app/api/chat/route.ts" "createInvoiceTools" "Invoice tools wired in chat route"
assert_file_contains "${ROOT_DIR}/src/convex/crons.ts" "invoice agent" "Invoice cron registered"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "runInvoiceAgent" "Invoice runner entry exists"
assert_file_contains "${ROOT_DIR}/src/convex/agentRunner.ts" "runInvoiceAgentForAppointment" "Event trigger exists"
assert_file_contains "${ROOT_DIR}/src/lib/ai/agents/registry.ts" "InvoiceHandler" "Invoice handler registered"
assert_file_contains "${ROOT_DIR}/src/convex/invoices.ts" "assertUserInOrganization" "Invoice auth checks present"
assert_file_contains "${ROOT_DIR}/src/convex/invoices.ts" "updateStatusInternal" "Internal status update mutation exists"
assert_file_contains "${ROOT_DIR}/src/convex/invoices.ts" "flagOverdueInvoiceById" "Invoice overdue flag mutation exists"
assert_file_contains "${ROOT_DIR}/src/lib/ai/prompts/system.ts" "## Invoicing" "System prompt includes invoicing guidance"
assert_file_contains "${ROOT_DIR}/src/convex/appointments.ts" "runInvoiceAgentForAppointment" "Appointment completion schedules invoice agent"

print_results
exit $fail

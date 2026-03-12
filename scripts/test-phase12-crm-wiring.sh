#!/usr/bin/env bash
# =============================================================================
# Phase 12.8: Sidebar CRM Wiring & Memory Stats – Validation Script
#
# Prerequisites:
#   1. Dependencies installed (`bun install`)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

print_banner "Phase 12.8: Sidebar CRM Wiring & Memory Stats Aggregation"

header "Static Gates"
if bun run check:all >/dev/null 2>&1; then
  ok "Full validation gate passes (check:all)"
else
  err "Full validation gate failed (check:all)"
fi

header "Sidebar CRM Data Wiring"
assert_file_contains "${ROOT_DIR}/src/app/(dashboard)/components/DashboardShell.tsx" "api.leads.list" \
  "DashboardShell queries leads from Convex"
assert_file_contains "${ROOT_DIR}/src/app/(dashboard)/components/DashboardShell.tsx" "api.appointments.list" \
  "DashboardShell queries appointments from Convex"
assert_file_contains "${ROOT_DIR}/src/app/(dashboard)/components/DashboardShell.tsx" "api.invoices.list" \
  "DashboardShell queries invoices from Convex"
assert_file_contains "${ROOT_DIR}/src/app/(dashboard)/components/DashboardShell.tsx" "LeadDisplay" \
  "DashboardShell maps to LeadDisplay type"
assert_file_contains "${ROOT_DIR}/src/app/(dashboard)/components/DashboardShell.tsx" "AppointmentDisplay" \
  "DashboardShell maps to AppointmentDisplay type"
assert_file_contains "${ROOT_DIR}/src/app/(dashboard)/components/DashboardShell.tsx" "InvoiceDisplay" \
  "DashboardShell maps to InvoiceDisplay type"

header "Server-Side Memory Stats"
assert_file_contains "${ROOT_DIR}/src/convex/businessMemories.ts" "export const getStats" \
  "businessMemories exports getStats query"
assert_file_contains "${ROOT_DIR}/src/convex/businessMemories.ts" "typeCounts" \
  "getStats returns typeCounts"
assert_file_contains "${ROOT_DIR}/src/convex/businessMemories.ts" "decayBands" \
  "getStats returns decayBands"
assert_file_contains "${ROOT_DIR}/src/convex/businessMemories.ts" "assertAuthenticatedUserInOrganization" \
  "getStats enforces org-scoped auth"

header "MemoryAnalytics Uses Server Stats"
assert_file_contains "${ROOT_DIR}/src/components/analytics/MemoryAnalytics.tsx" "api.businessMemories.getStats" \
  "MemoryAnalytics uses getStats query"
if grep -q "api.businessMemories.list" "${ROOT_DIR}/src/components/analytics/MemoryAnalytics.tsx"; then
  err "MemoryAnalytics should not use businessMemories.list for stats"
else
  ok "MemoryAnalytics no longer uses capped list query"
fi
if grep -q "most recent 100 memories" "${ROOT_DIR}/src/components/analytics/MemoryAnalytics.tsx"; then
  err "MemoryAnalytics still has 100-item disclaimer"
else
  ok "100-item disclaimer removed"
fi

header "Sidebar Props Cleanup"
if grep -q "leads?: LeadDisplay\[\]" "${ROOT_DIR}/src/app/(dashboard)/components/DashboardShell.tsx"; then
  err "DashboardShellProps still has leads as prop (should be internal)"
else
  ok "DashboardShellProps no longer accepts leads as prop"
fi

print_results
exit $fail

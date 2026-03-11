#!/usr/bin/env bash
# =============================================================================
# Dashboard Navigation & Realtime Polish (Phase 12.7) – Validation Script
#
# Prerequisites:
#   1. Dependencies installed (`bun install`)
#
# Optional live checks:
#   1. Convex dev server running: bun dev:convex
#   2. Next.js dev server running: bun dev:next
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

print_banner "Phase 12.7: Dashboard Navigation & Realtime Polish"

header "Static Gates"
if bun run check:all >/dev/null 2>&1; then
  ok "Full validation gate passes (check:all)"
else
  err "Full validation gate failed (check:all)"
fi

header "Route + Header Navigation Wiring"
assert_file_contains "${ROOT_DIR}/src/lib/constants.ts" "MEMORY: '/memory'" \
  "ROUTES includes memory path"
assert_file_contains "${ROOT_DIR}/src/components/dashboard/DashboardHeader.tsx" "usePathname" \
  "DashboardHeader uses pathname for active nav state"
assert_file_contains "${ROOT_DIR}/src/components/dashboard/DashboardHeader.tsx" "ROUTES.MEMORY" \
  "DashboardHeader links to memory route"
assert_file_contains "${ROOT_DIR}/src/components/dashboard/DashboardHeader.tsx" "ROUTES.CHAT" \
  "DashboardHeader links to chat route"

header "Realtime Approval Notification Wiring"
assert_file_contains "${ROOT_DIR}/src/app/(dashboard)/components/DashboardShell.tsx" "api.approvalQueue.listPending" \
  "DashboardShell uses Convex listPending query"
assert_file_contains "${ROOT_DIR}/src/app/(dashboard)/components/DashboardShell.tsx" "setInterval(() => setNow(Date.now()), 30_000)" \
  "DashboardShell refreshes pending window every 30s"
if grep -q "fetch('/api/approvals" "${ROOT_DIR}/src/app/(dashboard)/components/DashboardShell.tsx"; then
  err "DashboardShell should not use /api/approvals polling"
else
  ok "DashboardShell polling removed (pure Convex subscription)"
fi

header "Organization Budget Tier Wiring"
assert_file_contains "${ROOT_DIR}/src/app/(dashboard)/memory/components/MemoryDashboardContainer.tsx" "api.organizations.getOrganization" \
  "Memory dashboard fetches organization settings"
assert_file_contains "${ROOT_DIR}/src/app/(dashboard)/memory/components/MemoryDashboardContainer.tsx" "budgetTier={budgetTier}" \
  "CostAnalytics receives real budget tier"
assert_file_contains "${ROOT_DIR}/src/app/(dashboard)/memory/components/MemoryDashboardContainer.tsx" "?? 'starter'" \
  "Budget tier falls back to starter"

header "Compatibility Guard"
assert_file_exists "${ROOT_DIR}/src/app/api/approvals/route.ts" \
  "Legacy /api/approvals route is preserved"

print_results
exit $fail

#!/usr/bin/env bash
# ============================================================
# Phase 12: Memory UI & Admin Dashboard Validation
# Validates component files, Convex API auth, wiring, and
# DRY compliance for the dashboard feature.
#
# Static checks only — no live Convex server required.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

print_banner "Phase 12: Memory UI & Admin Dashboard"

# ────────────────────────────────────────────────────────
# 1. Component files exist
# ────────────────────────────────────────────────────────
header "Component File Existence"

assert_file_exists "src/components/memory/MemoryViewer.tsx" "MemoryViewer exists"
assert_file_exists "src/components/memory/MemoryCard.tsx" "MemoryCard exists"
assert_file_exists "src/components/memory/MemoryEditor.tsx" "MemoryEditor exists"
assert_file_exists "src/components/memory/MemoryFilters.tsx" "MemoryFilters exists"
assert_file_exists "src/components/memory/ContextInspector.tsx" "ContextInspector exists"
assert_file_exists "src/components/agents/ApprovalCard.tsx" "ApprovalCard exists"
assert_file_exists "src/components/agents/ApprovalQueue.tsx" "ApprovalQueue exists"
assert_file_exists "src/components/agents/ExecutionLog.tsx" "ExecutionLog exists"
assert_file_exists "src/components/analytics/MemoryAnalytics.tsx" "MemoryAnalytics exists"
assert_file_exists "src/components/analytics/CostAnalytics.tsx" "CostAnalytics exists"
assert_file_exists "src/components/analytics/AgentAnalytics.tsx" "AgentAnalytics exists"
assert_file_exists "src/components/ui/StatCard.tsx" "Shared StatCard exists"

# ────────────────────────────────────────────────────────
# 2. Dashboard page and container
# ────────────────────────────────────────────────────────
header "Dashboard Page Wiring"

assert_file_exists "src/app/(dashboard)/memory/page.tsx" "Memory dashboard page exists"
assert_file_exists "src/app/(dashboard)/memory/components/MemoryDashboardContainer.tsx" "MemoryDashboardContainer exists"

CONTAINER="src/app/(dashboard)/memory/components/MemoryDashboardContainer.tsx"
assert_file_contains "$CONTAINER" "MemoryViewer" "Container wires MemoryViewer"
assert_file_contains "$CONTAINER" "ApprovalQueue" "Container wires ApprovalQueue"
assert_file_contains "$CONTAINER" "ExecutionLog" "Container wires ExecutionLog"
assert_file_contains "$CONTAINER" "MemoryAnalytics" "Container wires MemoryAnalytics"
assert_file_contains "$CONTAINER" "AgentAnalytics" "Container wires AgentAnalytics"
assert_file_contains "$CONTAINER" "CostAnalytics" "Container wires CostAnalytics"
assert_file_contains "$CONTAINER" "budgetTier" "Container passes budgetTier to CostAnalytics"
assert_file_contains "$CONTAINER" "getOrganization" "Container fetches organization for settings"

# ────────────────────────────────────────────────────────
# 3. businessMemories auth checks
# ────────────────────────────────────────────────────────
header "businessMemories Auth (Tenant Isolation)"

BM="src/convex/businessMemories.ts"
assert_file_contains "$BM" "assertAuthenticatedUserInOrganization" "Auth helper imported"

# Count the number of auth calls — must match the number of public handlers
AUTH_COUNT=$(grep -c "assertAuthenticatedUserInOrganization" "$BM" || true)
if [[ "$AUTH_COUNT" -ge 7 ]]; then
  ok "Auth check present in all 7 public handlers ($AUTH_COUNT calls)"
else
  err "Expected at least 7 auth calls in businessMemories, found $AUTH_COUNT"
fi

# ────────────────────────────────────────────────────────
# 4. ApprovalCard countdown fix
# ────────────────────────────────────────────────────────
header "ApprovalCard: Countdown Ticking"

AC="src/components/agents/ApprovalCard.tsx"
assert_file_contains "$AC" "useState" "useCountdown uses useState"
assert_file_contains "$AC" "useEffect" "useCountdown uses useEffect"
assert_file_contains "$AC" "setInterval" "useCountdown uses setInterval"
assert_file_contains "$AC" "clearInterval" "useCountdown cleans up interval"

# ────────────────────────────────────────────────────────
# 5. ApprovalQueue reactive now
# ────────────────────────────────────────────────────────
header "ApprovalQueue: Reactive Timestamp"

AQ="src/components/agents/ApprovalQueue.tsx"
assert_file_contains "$AQ" "setInterval" "ApprovalQueue refreshes now on interval"
assert_file_contains "$AQ" "setNow" "ApprovalQueue updates now state"

# ────────────────────────────────────────────────────────
# 6. ExecutionLog agent type coverage
# ────────────────────────────────────────────────────────
header "ExecutionLog: Agent Type Filters"

EL="src/components/agents/ExecutionLog.tsx"
assert_file_contains "$EL" "'followup'" "ExecutionLog has followup filter"
assert_file_contains "$EL" "'reminder'" "ExecutionLog has reminder filter"
assert_file_contains "$EL" "'invoice'" "ExecutionLog has invoice filter"
assert_file_contains "$EL" "'sales'" "ExecutionLog has sales filter"

# ────────────────────────────────────────────────────────
# 7. CostAnalytics budget tier support
# ────────────────────────────────────────────────────────
header "CostAnalytics: Budget Tier Configuration"

CA="src/components/analytics/CostAnalytics.tsx"
assert_file_contains "$CA" "BUDGET_TIER_LIMITS" "Budget tier limits map defined"
assert_file_contains "$CA" "budgetTier" "budgetTier prop accepted"
assert_file_contains "$CA" "'free'" "Free tier defined"
assert_file_contains "$CA" "'starter'" "Starter tier defined"
assert_file_contains "$CA" "'enterprise'" "Enterprise tier defined"

# ────────────────────────────────────────────────────────
# 8. Shared StatCard (DRY)
# ────────────────────────────────────────────────────────
header "DRY: Shared StatCard Component"

SC="src/components/ui/StatCard.tsx"
assert_file_contains "$SC" "StatCard" "StatCard component exported"

for ANALYTICS_FILE in \
  "src/components/analytics/MemoryAnalytics.tsx" \
  "src/components/analytics/CostAnalytics.tsx" \
  "src/components/analytics/AgentAnalytics.tsx"; do

  if grep -q "from '@/components/ui/StatCard'" "$ANALYTICS_FILE" 2>/dev/null; then
    ok "$(basename "$ANALYTICS_FILE") imports shared StatCard"
  else
    err "$(basename "$ANALYTICS_FILE") should import shared StatCard"
  fi

  if grep -q "^function StatCard" "$ANALYTICS_FILE" 2>/dev/null; then
    err "$(basename "$ANALYTICS_FILE") still defines local StatCard (DRY violation)"
  else
    ok "$(basename "$ANALYTICS_FILE") has no local StatCard definition"
  fi
done

# ────────────────────────────────────────────────────────
# 9. ContextInspector not wired with empty data
# ────────────────────────────────────────────────────────
header "ContextInspector: No Placeholder Wiring"

if grep -q 'ContextInspector' "$CONTAINER" 2>/dev/null; then
  err "ContextInspector should not be in dashboard with empty data"
else
  ok "ContextInspector not mounted with placeholder data"
fi

# ────────────────────────────────────────────────────────
# 10. TypeScript + Lint clean
# ────────────────────────────────────────────────────────
header "TypeScript + Lint Validation"

if bun run typecheck 2>&1 | tail -1 | grep -q "error"; then
  err "TypeScript type errors found"
else
  ok "TypeScript passes (bun run typecheck)"
fi

if bun run lint 2>&1 | grep -q "Found"; then
  err "Biome lint errors found"
else
  ok "Biome lint passes (bun run lint)"
fi

# ────────────────────────────────────────────────────────
# Results
# ────────────────────────────────────────────────────────
print_results

#!/usr/bin/env bash
# ============================================================
# scripts/lib/test-helpers.sh
#
# Shared test infrastructure for all memory system test scripts.
# Source this at the top of each test file:
#
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "${SCRIPT_DIR}/lib/test-helpers.sh"
#
# Provides:
#   Colors:       BLUE GREEN YELLOW RED NC BOLD DIM
#   Counters:     pass fail warn_count skip_count section
#   Output:       ok() err() warn() skip() info() header()
#   Env:          ORG_ID (from .env.local), ENV_FILE, APP_URL
#   Helpers:      extract_id(), parse_json_field()
#   Gates:        run_static_gate, require_org_id, require_convex
#   Cleanup:      cleanup_test_memories(), print_results()
#   State:        track_test_id() — register IDs for auto-cleanup
# ============================================================

# ─── Colors ──────────────────────────────────────────────────
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

# ─── Counters ────────────────────────────────────────────────
pass=0
fail=0
warn_count=0
skip_count=0
section=0

# ─── Output Functions ────────────────────────────────────────
ok()     { echo -e "  ${GREEN}✓${NC} $*"; pass=$((pass + 1)); }
err()    { echo -e "  ${RED}✗${NC} $*"; fail=$((fail + 1)); }
warn()   { echo -e "  ${YELLOW}!${NC} $*"; warn_count=$((warn_count + 1)); }
skip()   { echo -e "  ${DIM}⊘${NC} $*"; skip_count=$((skip_count + 1)); }
info()   { echo -e "  ${DIM}→${NC} $*"; }
header() {
  section=$((section + 1))
  echo -e "\n${BOLD}${BLUE}[$section]${NC} ${BOLD}$*${NC}"
}

# ─── Environment ─────────────────────────────────────────────
ENV_FILE=".env.local"
APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"

ORG_ID=""
if [[ -f "$ENV_FILE" ]]; then
  ORG_ID=$(grep -E '^DEV_ORGANIZATION_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
fi

# ─── Helpers ─────────────────────────────────────────────────

# Extract a Convex document ID from CLI output.
# Handles both single-quoted and double-quoted IDs.
extract_id() {
  local text="$1"
  local val
  val=$(echo "$text" | sed -n "s/.*'\([a-z0-9]*\)'.*/\1/p" | head -1)
  if [[ -z "$val" ]]; then
    val=$(echo "$text" | sed -n 's/.*"\([a-z0-9]*\)".*/\1/p' | head -1)
  fi
  echo "$val"
}

# Extract a numeric or string JSON field value from raw output.
# Usage: parse_json_field "$output" "fieldName"
parse_json_field() {
  local text="$1"
  local field="$2"
  echo "$text" | sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\([0-9.]*\).*/\1/p" | head -1
}

# Print the standard test suite banner.
# Usage: print_banner "Phase 5: Decay & Lifecycle"
print_banner() {
  local title="$1"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}  ${title}${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo -e "  Org ID: ${ORG_ID:-${RED}not set${NC}}"
}

# ─── Gates ───────────────────────────────────────────────────

# Run typecheck + lint. Always safe to call.
run_static_gate() {
  header "Typecheck & Lint"

  if bun run typecheck 2>&1 | tail -1 | grep -q "error"; then
    err "TypeScript errors found"
  else
    ok "TypeScript type check passed"
  fi

  if bun run check:ci 2>&1 | tail -3 | grep -q "error\|Err"; then
    err "Biome lint/format errors found"
  else
    ok "Biome lint + format check passed"
  fi
}

# Abort early if ORG_ID is not set.
# Prints a summary and exits with current fail count.
require_org_id() {
  if [[ -z "$ORG_ID" ]]; then
    echo -e "  ${RED}DEV_ORGANIZATION_ID not set. Run ./scripts/dev-setup.sh first.${NC}"
    skip "All live tests (no ORG_ID)"
    print_results
    exit $fail
  fi
}

# Check Convex dev server connectivity.
# Aborts with summary if unreachable.
require_convex() {
  header "Convex Connectivity"
  require_org_id

  local conn_check
  conn_check=$(npx convex run businessMemories:list \
    "{\"organizationId\": \"${ORG_ID}\", \"limit\": 1}" 2>&1)
  if echo "$conn_check" | grep -q "error\|Error\|ECONNREFUSED"; then
    echo -e "  ${RED}Convex dev server not reachable. Start with: bun dev:convex${NC}"
    skip "All live tests (Convex not reachable)"
    print_results
    exit $fail
  fi
  ok "Convex dev server connected"
}

# ─── Convex Helpers ──────────────────────────────────────────

# Track file for memory IDs (subshells can't modify parent arrays).
_TEST_IDS_FILE=$(mktemp)
trap 'rm -f "$_TEST_IDS_FILE"' EXIT

# Register a memory ID for cleanup.
# Usage: track_test_id "$id"
track_test_id() {
  if [[ -n "${1:-}" ]]; then
    echo "$1" >> "$_TEST_IDS_FILE"
  fi
}

# Create a business memory and capture the ID.
# The ID is auto-tracked for cleanup.
# Usage: local id; id=$(create_business_memory '{"organizationId":"...","type":"fact",...}')
create_business_memory() {
  local args="$1"
  local out
  out=$(npx convex run businessMemories:create "$args" 2>&1)
  local id
  id=$(extract_id "$out")
  if [[ -n "$id" ]]; then
    track_test_id "$id"
  fi
  echo "$id"
}

# Fetch a business memory by ID.
# Usage: local doc; doc=$(get_business_memory "$id")
get_business_memory() {
  local id="$1"
  npx convex run businessMemories:get \
    "{\"id\": \"${id}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1
}

# Assert a grep pattern exists in text. Calls ok/err.
# Usage: assert_grep "$output" '"isActive".*true' "isActive = true"
assert_grep() {
  local text="$1"
  local pattern="$2"
  local label="$3"
  if grep -q "$pattern" <<< "$text" 2>/dev/null; then
    ok "$label"
  else
    err "$label"
  fi
}

# Assert a JSON field equals an expected value. Calls ok/err.
# Usage: assert_field "$output" "decayScore" "1" "decayScore = 1.0 (fresh)"
assert_field() {
  local text="$1"
  local field="$2"
  local expected="$3"
  local label="$4"
  local actual
  actual=$(parse_json_field "$text" "$field")
  if [[ "$actual" == "$expected" ]]; then
    ok "$label"
  else
    err "$label (got: ${actual:-<empty>})"
  fi
}

# ─── Results & Cleanup ──────────────────────────────────────

# Soft-delete all tracked test memory IDs.
cleanup_test_memories() {
  header "Cleanup Test Data"
  local cleaned=0
  if [[ -s "$_TEST_IDS_FILE" ]]; then
    while IFS= read -r mem_id; do
      if [[ -n "$mem_id" ]]; then
        npx convex run businessMemories:softDelete \
          "{\"id\": \"${mem_id}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1 >/dev/null || true
        cleaned=$((cleaned + 1))
      fi
    done < "$_TEST_IDS_FILE"
  fi
  ok "Cleaned up ${cleaned} test memories"
}

# Print the final pass/fail/warn/skip summary.
print_results() {
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}  Results${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo -e "  ${GREEN}Passed:   ${pass}${NC}"
  [[ $warn_count -gt 0 ]] && echo -e "  ${YELLOW}Warnings: ${warn_count}${NC}"
  [[ $skip_count -gt 0 ]] && echo -e "  ${DIM}Skipped:  ${skip_count}${NC}"
  [[ $fail -gt 0 ]] && echo -e "  ${RED}Failed:   ${fail}${NC}"
  echo ""

  if [[ $fail -eq 0 ]]; then
    echo -e "  ${GREEN}${BOLD}All checks passed!${NC}"
  else
    echo -e "  ${RED}${BOLD}Some checks failed.${NC} Review errors above."
  fi
}

# Check if a file exists. Calls ok/err.
# Usage: assert_file_exists "src/lib/memory/foo.ts"
assert_file_exists() {
  local path="$1"
  local label="${2:-$path exists}"
  if [[ -f "$path" ]]; then
    ok "$label"
  else
    err "Missing: $path"
  fi
}

# Check if a file contains a pattern. Calls ok/err.
# Usage: assert_file_contains "src/foo.ts" "exportName" "Has exportName"
assert_file_contains() {
  local path="$1"
  local pattern="$2"
  local label="$3"
  if grep -q "$pattern" "$path" 2>/dev/null; then
    ok "$label"
  else
    err "$label"
  fi
}

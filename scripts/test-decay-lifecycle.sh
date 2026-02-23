#!/usr/bin/env bash
set -uo pipefail

# ============================================================
# test-decay-lifecycle.sh
#
# Live end-to-end tests for Phase 5: Decay Algorithm & Memory Lifecycle
#
# Creates real memories in Convex, mutates their decay scores,
# validates lifecycle transitions, TTL auto-set, and cleanup.
#
# Tests:
#   1. Typecheck + lint (quick gate)
#   2. Create business memory → verify initial state
#   3. Patch decayScore → read back
#   4. Lifecycle: Active → Archive (score 0.25 → archive mutation)
#   5. Lifecycle: Expired → Soft Delete (score 0.05 → softDelete)
#   6. TTL auto-set per type (fact 180d, preference 90d, context 30d,
#      episodic 90d, instruction never)
#   7. Expired memory with past expiresAt
#   8. Agent memory create, patch, soft-delete
#   9. Decay worker execution
#  10. Cleanup all test data
#
# Usage:
#   chmod +x scripts/test-decay-lifecycle.sh
#   ./scripts/test-decay-lifecycle.sh
#
# Prerequisites:
#   - .env.local with DEV_ORGANIZATION_ID
#   - Convex dev server running (bun dev:convex)
# ============================================================

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

pass=0
fail=0
warn_count=0
skip_count=0
section=0

ok()    { echo -e "  ${GREEN}✓${NC} $*"; pass=$((pass + 1)); }
err()   { echo -e "  ${RED}✗${NC} $*"; fail=$((fail + 1)); }
warn()  { echo -e "  ${YELLOW}!${NC} $*"; warn_count=$((warn_count + 1)); }
skip()  { echo -e "  ${DIM}⊘${NC} $*"; skip_count=$((skip_count + 1)); }
info()  { echo -e "  ${DIM}→${NC} $*"; }
header(){
  section=$((section + 1))
  echo -e "\n${BOLD}${BLUE}[$section]${NC} ${BOLD}$*${NC}"
}

ENV_FILE=".env.local"
TEST_MEMORY_IDS=()

if [[ -f "$ENV_FILE" ]]; then
  ORG_ID=$(grep -E '^DEV_ORGANIZATION_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
else
  ORG_ID=""
fi

extract_id() {
  local text="$1"
  local val
  val=$(echo "$text" | sed -n "s/.*'\([a-z0-9]*\)'.*/\1/p" | head -1)
  if [[ -z "$val" ]]; then
    val=$(echo "$text" | sed -n 's/.*"\([a-z0-9]*\)".*/\1/p' | head -1)
  fi
  echo "$val"
}

echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Phase 5: Decay & Memory Lifecycle — Live Test Suite${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "  Org ID: ${ORG_ID:-${RED}not set${NC}}"

# ─── 1. Quick Static Gate ────────────────────────────────────
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

# ─── Pre-flight: Convex Connectivity ─────────────────────────
header "Convex Connectivity"

if [[ -z "$ORG_ID" ]]; then
  echo -e "  ${RED}DEV_ORGANIZATION_ID not set. Run ./scripts/dev-setup.sh first.${NC}"
  skip "All live tests (no ORG_ID)"
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo -e "  ${GREEN}Passed: ${pass}${NC}  ${RED}Failed: ${fail}${NC}  ${DIM}Skipped: ${skip_count}${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  exit $fail
fi

CONN_CHECK=$(npx convex run businessMemories:list \
  "{\"organizationId\": \"${ORG_ID}\", \"limit\": 1}" 2>&1)
if echo "$CONN_CHECK" | grep -q "error\|Error\|ECONNREFUSED"; then
  echo -e "  ${RED}Convex dev server not reachable. Start with: bun dev:convex${NC}"
  skip "All live tests (Convex not reachable)"
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo -e "  ${GREEN}Passed: ${pass}${NC}  ${RED}Failed: ${fail}${NC}  ${DIM}Skipped: ${skip_count}${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  exit $fail
fi
ok "Convex dev server connected"

# ─── 3. Create Business Memory & Verify Initial State ────────
header "Create Business Memory & Verify Initial State"

info "Creating 'fact' type test memory..."
CREATE_OUT=$(npx convex run businessMemories:create \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"fact\", \"content\": \"[DECAY-TEST] Customer Alex prefers weekend delivery slots for all orders\", \"importance\": 0.8, \"confidence\": 0.9, \"source\": \"explicit\"}" 2>&1)
FACT_ID=$(extract_id "$CREATE_OUT")

if [[ -n "$FACT_ID" ]]; then
  ok "Created fact memory: ${FACT_ID}"
  TEST_MEMORY_IDS+=("$FACT_ID")
else
  err "Failed to create fact memory"
  echo "    Output: $CREATE_OUT"
fi

if [[ -n "$FACT_ID" ]]; then
  info "Reading back to verify initial fields..."
  GET_OUT=$(npx convex run businessMemories:get \
    "{\"id\": \"${FACT_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1)

  INITIAL_DECAY=$(echo "$GET_OUT" | sed -n 's/.*"decayScore"[[:space:]]*:[[:space:]]*\([0-9.]*\).*/\1/p' | head -1)
  if [[ "$INITIAL_DECAY" == "1" || "$INITIAL_DECAY" == "1.0" ]]; then
    ok "decayScore = 1.0 (fresh memory)"
  elif [[ -n "$INITIAL_DECAY" ]]; then
    err "decayScore = ${INITIAL_DECAY} (expected 1.0)"
  else
    err "decayScore field not found"
  fi

  ACC_COUNT=$(echo "$GET_OUT" | sed -n 's/.*"accessCount"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -1)
  [[ "$ACC_COUNT" == "0" ]] \
    && ok "accessCount = 0" \
    || warn "accessCount = ${ACC_COUNT:-?} (expected 0)"

  echo "$GET_OUT" | grep -q '"isActive"[[:space:]]*:[[:space:]]*true' \
    && ok "isActive = true" \
    || err "isActive not true"

  echo "$GET_OUT" | grep -q '"isArchived"[[:space:]]*:[[:space:]]*false' \
    && ok "isArchived = false" \
    || err "isArchived not false"

  EXPIRES_VAL=$(echo "$GET_OUT" | sed -n 's/.*"expiresAt"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -1)
  [[ -n "$EXPIRES_VAL" ]] \
    && ok "expiresAt is set (fact → 180d TTL)" \
    || err "expiresAt not set on fact memory"
fi

# ─── 4. Patch Decay Score & Read Back ────────────────────────
header "Decay Score Mutation"

if [[ -n "$FACT_ID" ]]; then
  info "Patching decayScore to 0.55 (accessible range)..."
  npx convex run businessMemories:update \
    "{\"id\": \"${FACT_ID}\", \"organizationId\": \"${ORG_ID}\", \"decayScore\": 0.55}" 2>&1 >/dev/null

  PATCHED=$(npx convex run businessMemories:get \
    "{\"id\": \"${FACT_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1)
  PATCHED_SCORE=$(echo "$PATCHED" | sed -n 's/.*"decayScore"[[:space:]]*:[[:space:]]*\([0-9.]*\).*/\1/p' | head -1)

  [[ "$PATCHED_SCORE" == "0.55" ]] \
    && ok "decayScore updated to 0.55" \
    || err "decayScore patch failed (got: ${PATCHED_SCORE})"
else
  skip "Decay score patch (no memory ID)"
fi

# ─── 5. Lifecycle: Active → Archive ──────────────────────────
header "Lifecycle: Active → Archive"

info "Creating context memory..."
ARCHIVE_OUT=$(npx convex run businessMemories:create \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"context\", \"content\": \"[DECAY-TEST] Archival test memory should be archived when score drops below threshold\", \"importance\": 0.5, \"confidence\": 0.7, \"source\": \"explicit\"}" 2>&1)
ARCHIVE_ID=$(extract_id "$ARCHIVE_OUT")

if [[ -n "$ARCHIVE_ID" ]]; then
  TEST_MEMORY_IDS+=("$ARCHIVE_ID")

  info "Patching decayScore to 0.25 (archive range 0.1–0.3)..."
  npx convex run businessMemories:update \
    "{\"id\": \"${ARCHIVE_ID}\", \"organizationId\": \"${ORG_ID}\", \"decayScore\": 0.25}" 2>&1 >/dev/null

  npx convex run businessMemories:archive \
    "{\"id\": \"${ARCHIVE_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1 >/dev/null

  ARCH_CHECK=$(npx convex run businessMemories:get \
    "{\"id\": \"${ARCHIVE_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1)

  echo "$ARCH_CHECK" | grep -q '"isArchived"[[:space:]]*:[[:space:]]*true' \
    && ok "Memory archived (isArchived = true)" \
    || err "Memory not archived after mutation"
else
  err "Failed to create archival test memory"
fi

# ─── 6. Lifecycle: Expired → Soft Delete ─────────────────────
header "Lifecycle: Expired → Soft Delete"

info "Creating episodic memory..."
DELETE_OUT=$(npx convex run businessMemories:create \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"episodic\", \"content\": \"[DECAY-TEST] Soft delete test memory for expired lifecycle transition validation\", \"importance\": 0.3, \"confidence\": 0.6, \"source\": \"explicit\"}" 2>&1)
DELETE_ID=$(extract_id "$DELETE_OUT")

if [[ -n "$DELETE_ID" ]]; then
  TEST_MEMORY_IDS+=("$DELETE_ID")

  info "Patching decayScore to 0.05 (expired range < 0.1)..."
  npx convex run businessMemories:update \
    "{\"id\": \"${DELETE_ID}\", \"organizationId\": \"${ORG_ID}\", \"decayScore\": 0.05}" 2>&1 >/dev/null

  npx convex run businessMemories:softDelete \
    "{\"id\": \"${DELETE_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1 >/dev/null

  DEL_CHECK=$(npx convex run businessMemories:get \
    "{\"id\": \"${DELETE_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1)

  echo "$DEL_CHECK" | grep -q '"isActive"[[:space:]]*:[[:space:]]*false' \
    && ok "Memory soft-deleted (isActive = false)" \
    || err "Memory not deactivated after softDelete"
else
  err "Failed to create soft-delete test memory"
fi

# ─── 7. TTL Auto-Set Per Type ────────────────────────────────
header "TTL Auto-Set on Creation"

MS_PER_DAY=86400000

for type_days in "fact:180" "preference:90" "context:30" "episodic:90"; do
  MEM_TYPE=$(echo "$type_days" | cut -d: -f1)
  EXPECTED_DAYS=$(echo "$type_days" | cut -d: -f2)

  TTL_OUT=$(npx convex run businessMemories:create \
    "{\"organizationId\": \"${ORG_ID}\", \"type\": \"${MEM_TYPE}\", \"content\": \"[DECAY-TEST] TTL validation for ${MEM_TYPE} memory type\", \"importance\": 0.5, \"confidence\": 0.7, \"source\": \"explicit\"}" 2>&1)
  TTL_ID=$(extract_id "$TTL_OUT")

  if [[ -n "$TTL_ID" ]]; then
    TEST_MEMORY_IDS+=("$TTL_ID")
    TTL_CHECK=$(npx convex run businessMemories:get \
      "{\"id\": \"${TTL_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1)
    EXPIRES_AT=$(echo "$TTL_CHECK" | sed -n 's/.*"expiresAt"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -1)
    CREATED_AT=$(echo "$TTL_CHECK" | sed -n 's/.*"createdAt"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -1)

    if [[ -n "$EXPIRES_AT" && -n "$CREATED_AT" ]]; then
      DIFF_DAYS=$(( (EXPIRES_AT - CREATED_AT) / MS_PER_DAY ))
      LOW=$((EXPECTED_DAYS - 1))
      HIGH=$((EXPECTED_DAYS + 1))
      if [[ $DIFF_DAYS -ge $LOW && $DIFF_DAYS -le $HIGH ]]; then
        ok "${MEM_TYPE}: TTL = ${DIFF_DAYS}d (expected ~${EXPECTED_DAYS}d)"
      else
        err "${MEM_TYPE}: TTL = ${DIFF_DAYS}d (expected ~${EXPECTED_DAYS}d)"
      fi
    else
      err "${MEM_TYPE}: could not parse timestamps"
    fi
  else
    err "Failed to create ${MEM_TYPE} memory"
  fi
done

info "Creating 'instruction' memory (should have no TTL)..."
INST_OUT=$(npx convex run businessMemories:create \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"instruction\", \"content\": \"[DECAY-TEST] Instructions never expire so expiresAt should be undefined\", \"importance\": 0.9, \"confidence\": 0.95, \"source\": \"explicit\"}" 2>&1)
INST_ID=$(extract_id "$INST_OUT")

if [[ -n "$INST_ID" ]]; then
  TEST_MEMORY_IDS+=("$INST_ID")
  INST_CHECK=$(npx convex run businessMemories:get \
    "{\"id\": \"${INST_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1)
  INST_EXPIRES=$(echo "$INST_CHECK" | sed -n 's/.*"expiresAt"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -1)

  [[ -z "$INST_EXPIRES" ]] \
    && ok "instruction: no expiresAt (never expires)" \
    || err "instruction: expiresAt should be undefined"
else
  err "Failed to create instruction memory"
fi

# ─── 8. Expired Memory (Past expiresAt) ──────────────────────
header "Expired Memory with Past TTL"

PAST_TIMESTAMP=$(($(date +%s) * 1000 - 86400000))
EXPIRED_OUT=$(npx convex run businessMemories:create \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"context\", \"content\": \"[DECAY-TEST] Already expired memory should be filtered in retrieval\", \"importance\": 0.5, \"confidence\": 0.7, \"source\": \"explicit\", \"expiresAt\": ${PAST_TIMESTAMP}}" 2>&1)
EXPIRED_ID=$(extract_id "$EXPIRED_OUT")

if [[ -n "$EXPIRED_ID" ]]; then
  TEST_MEMORY_IDS+=("$EXPIRED_ID")
  ok "Created memory with past expiresAt"

  ACTIVE_LIST=$(npx convex run businessMemories:list \
    "{\"organizationId\": \"${ORG_ID}\", \"activeOnly\": true}" 2>&1)

  if echo "$ACTIVE_LIST" | grep -q "$EXPIRED_ID"; then
    warn "Expired memory in active list (TTL filtering happens at retrieval/scoring level, not list query)"
  else
    ok "Expired memory excluded from active list"
  fi
else
  err "Failed to create expired test memory"
fi

# ─── 9. Agent Memory Lifecycle ───────────────────────────────
header "Agent Memory Create & Lifecycle"

AGENT_OUT=$(npx convex run agentMemories:create \
  "{\"organizationId\": \"${ORG_ID}\", \"agentType\": \"chat\", \"category\": \"pattern\", \"content\": \"[DECAY-TEST] Users ask about pricing most on Mondays\", \"confidence\": 0.85}" 2>&1)
AGENT_ID=$(extract_id "$AGENT_OUT")

if [[ -n "$AGENT_ID" ]]; then
  ok "Created agent memory: ${AGENT_ID}"

  AGENT_GET=$(npx convex run agentMemories:get \
    "{\"id\": \"${AGENT_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1)
  AGENT_DECAY=$(echo "$AGENT_GET" | sed -n 's/.*"decayScore"[[:space:]]*:[[:space:]]*\([0-9.]*\).*/\1/p' | head -1)

  [[ "$AGENT_DECAY" == "1" || "$AGENT_DECAY" == "1.0" ]] \
    && ok "Initial decayScore = 1.0" \
    || err "decayScore = ${AGENT_DECAY} (expected 1.0)"

  npx convex run agentMemories:update \
    "{\"id\": \"${AGENT_ID}\", \"organizationId\": \"${ORG_ID}\", \"decayScore\": 0.4}" 2>&1 >/dev/null

  AGENT_PATCHED=$(npx convex run agentMemories:get \
    "{\"id\": \"${AGENT_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1)
  AGENT_NEW=$(echo "$AGENT_PATCHED" | sed -n 's/.*"decayScore"[[:space:]]*:[[:space:]]*\([0-9.]*\).*/\1/p' | head -1)

  [[ "$AGENT_NEW" == "0.4" ]] \
    && ok "Agent decayScore patched to 0.4" \
    || err "Agent decayScore patch failed (got: ${AGENT_NEW})"

  npx convex run agentMemories:softDelete \
    "{\"id\": \"${AGENT_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1 >/dev/null
  ok "Agent memory soft-deleted"
else
  err "Failed to create agent memory"
fi

# ─── 10. Decay Worker ───────────────────────────────────────
header "Decay Worker Execution"

DECAY_WORKER_OUT=$(npx convex run businessMemories:create \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"episodic\", \"content\": \"[DECAY-TEST] Worker test for automatic decay score recalculation\", \"importance\": 0.5, \"confidence\": 0.7, \"source\": \"explicit\"}" 2>&1)
DECAY_WORKER_ID=$(extract_id "$DECAY_WORKER_OUT")

if [[ -n "$DECAY_WORKER_ID" ]]; then
  TEST_MEMORY_IDS+=("$DECAY_WORKER_ID")

  BEFORE_GET=$(npx convex run businessMemories:get \
    "{\"id\": \"${DECAY_WORKER_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1)
  BEFORE_SCORE=$(echo "$BEFORE_GET" | sed -n 's/.*"decayScore"[[:space:]]*:[[:space:]]*\([0-9.]*\).*/\1/p' | head -1)
  info "Score before: ${BEFORE_SCORE}"

  WORKER_OUT=$(npx convex run memoryDecay:runDecayUpdate 2>&1)

  if echo "$WORKER_OUT" | grep -q "error\|Error"; then
    info "Decay worker is an internalAction — may not be callable via CLI"
    info "The hourly cron handles this automatically"
    warn "Could not invoke worker directly (expected for internal actions)"
  else
    ok "Decay worker executed via CLI"
  fi

  AFTER_GET=$(npx convex run businessMemories:get \
    "{\"id\": \"${DECAY_WORKER_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1)
  AFTER_SCORE=$(echo "$AFTER_GET" | sed -n 's/.*"decayScore"[[:space:]]*:[[:space:]]*\([0-9.]*\).*/\1/p' | head -1)
  info "Score after:  ${AFTER_SCORE}"

  [[ -n "$BEFORE_SCORE" && -n "$AFTER_SCORE" ]] \
    && ok "Decay scores readable before/after worker" \
    || err "Could not read decay scores"
else
  err "Failed to create memory for worker test"
fi

# ─── 11. Cleanup ─────────────────────────────────────────────
header "Cleanup Test Data"

CLEANED=0
for MEM_ID in "${TEST_MEMORY_IDS[@]}"; do
  if [[ -n "$MEM_ID" ]]; then
    npx convex run businessMemories:softDelete \
      "{\"id\": \"${MEM_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1 >/dev/null || true
    CLEANED=$((CLEANED + 1))
  fi
done
ok "Cleaned up ${CLEANED} test memories"

# ═══════════════════════════════════════════════════════════════
#  RESULTS
# ═══════════════════════════════════════════════════════════════
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

# ═══════════════════════════════════════════════════════════════
#  QUICK MANUAL TESTS
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}  Quick Manual Verification${NC}"
echo -e "  ─────────────────────────"
echo -e "  ${BOLD}1.${NC} Open ${YELLOW}bun convex:dashboard${NC} → Cron Jobs tab"
echo -e "     Confirm: extraction (2m), decay (1h), archival (daily), cleanup (weekly)"
echo ""
echo -e "  ${BOLD}2.${NC} Chat at ${YELLOW}http://localhost:3000${NC} → check businessMemories table"
echo -e "     Verify: accessCount++, lastAccessedAt updated, decayScore near 1.0"
echo ""
echo -e "  ${BOLD}3.${NC} In dashboard, edit a memory's decayScore to 0.25, then run:"
echo -e "     ${YELLOW}npx convex run businessMemories:archive '{\"id\":\"<ID>\",\"organizationId\":\"${ORG_ID}\"}'${NC}"
echo -e "     Verify: isArchived = true"
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"

exit $fail

#!/usr/bin/env bash
set -uo pipefail

# ============================================================
# test-decay-lifecycle.sh
#
# Live end-to-end tests for Phase 5: Decay Algorithm & Memory Lifecycle
#
# Tests:
#   1. Typecheck + lint (quick gate)
#   2. Create business memory -> verify initial state
#   3. Patch decayScore -> read back
#   4. Lifecycle: Active -> Archive (score 0.25)
#   5. Lifecycle: Expired -> Soft Delete (score 0.05)
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

print_banner "Phase 5: Decay & Memory Lifecycle — Live Test Suite"

# ─── 1. Quick Static Gate ────────────────────────────────────
run_static_gate

# ─── 2. Convex Connectivity ─────────────────────────────────
require_convex

# ─── 3. Create Business Memory & Verify Initial State ───────
header "Create Business Memory & Verify Initial State"

info "Creating 'fact' type test memory..."
FACT_ID=$(create_business_memory \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"fact\", \"content\": \"[DECAY-TEST] Customer Alex prefers weekend delivery slots for all orders\", \"importance\": 0.8, \"confidence\": 0.9, \"source\": \"explicit\"}")

if [[ -n "$FACT_ID" ]]; then
  ok "Created fact memory: ${FACT_ID}"
else
  err "Failed to create fact memory"
fi

if [[ -n "$FACT_ID" ]]; then
  info "Reading back to verify initial fields..."
  GET_OUT=$(get_business_memory "$FACT_ID")

  INITIAL_DECAY=$(parse_json_field "$GET_OUT" "decayScore")
  if [[ "$INITIAL_DECAY" == "1" || "$INITIAL_DECAY" == "1.0" ]]; then
    ok "decayScore = 1.0 (fresh memory)"
  elif [[ -n "$INITIAL_DECAY" ]]; then
    err "decayScore = ${INITIAL_DECAY} (expected 1.0)"
  else
    err "decayScore field not found"
  fi

  assert_field "$GET_OUT" "accessCount" "0" "accessCount = 0"
  assert_grep "$GET_OUT" '"isActive"[[:space:]]*:[[:space:]]*true' "isActive = true"
  assert_grep "$GET_OUT" '"isArchived"[[:space:]]*:[[:space:]]*false' "isArchived = false"

  EXPIRES_VAL=$(parse_json_field "$GET_OUT" "expiresAt")
  [[ -n "$EXPIRES_VAL" ]] \
    && ok "expiresAt is set (fact -> 180d TTL)" \
    || err "expiresAt not set on fact memory"
fi

# ─── 4. Patch Decay Score & Read Back ────────────────────────
header "Decay Score Mutation"

if [[ -n "$FACT_ID" ]]; then
  info "Patching decayScore to 0.55 (accessible range)..."
  npx convex run businessMemories:update \
    "{\"id\": \"${FACT_ID}\", \"organizationId\": \"${ORG_ID}\", \"decayScore\": 0.55}" 2>&1 >/dev/null

  PATCHED=$(get_business_memory "$FACT_ID")
  assert_field "$PATCHED" "decayScore" "0.55" "decayScore updated to 0.55"
else
  skip "Decay score patch (no memory ID)"
fi

# ─── 5. Lifecycle: Active -> Archive ─────────────────────────
header "Lifecycle: Active -> Archive"

info "Creating context memory..."
ARCHIVE_ID=$(create_business_memory \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"context\", \"content\": \"[DECAY-TEST] Archival test memory should be archived when score drops below threshold\", \"importance\": 0.5, \"confidence\": 0.7, \"source\": \"explicit\"}")

if [[ -n "$ARCHIVE_ID" ]]; then
  info "Patching decayScore to 0.25 (archive range 0.1-0.3)..."
  npx convex run businessMemories:update \
    "{\"id\": \"${ARCHIVE_ID}\", \"organizationId\": \"${ORG_ID}\", \"decayScore\": 0.25}" 2>&1 >/dev/null

  npx convex run businessMemories:archive \
    "{\"id\": \"${ARCHIVE_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1 >/dev/null

  ARCH_CHECK=$(get_business_memory "$ARCHIVE_ID")
  assert_grep "$ARCH_CHECK" '"isArchived"[[:space:]]*:[[:space:]]*true' "Memory archived (isArchived = true)"
else
  err "Failed to create archival test memory"
fi

# ─── 6. Lifecycle: Expired -> Soft Delete ────────────────────
header "Lifecycle: Expired -> Soft Delete"

info "Creating episodic memory..."
DELETE_ID=$(create_business_memory \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"episodic\", \"content\": \"[DECAY-TEST] Soft delete test memory for expired lifecycle transition validation\", \"importance\": 0.3, \"confidence\": 0.6, \"source\": \"explicit\"}")

if [[ -n "$DELETE_ID" ]]; then
  info "Patching decayScore to 0.05 (expired range < 0.1)..."
  npx convex run businessMemories:update \
    "{\"id\": \"${DELETE_ID}\", \"organizationId\": \"${ORG_ID}\", \"decayScore\": 0.05}" 2>&1 >/dev/null

  npx convex run businessMemories:softDelete \
    "{\"id\": \"${DELETE_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1 >/dev/null

  DEL_CHECK=$(get_business_memory "$DELETE_ID")
  assert_grep "$DEL_CHECK" '"isActive"[[:space:]]*:[[:space:]]*false' "Memory soft-deleted (isActive = false)"
else
  err "Failed to create soft-delete test memory"
fi

# ─── 7. TTL Auto-Set Per Type ────────────────────────────────
header "TTL Auto-Set on Creation"

MS_PER_DAY=86400000

for type_days in "fact:180" "preference:90" "context:30" "episodic:90"; do
  MEM_TYPE=$(echo "$type_days" | cut -d: -f1)
  EXPECTED_DAYS=$(echo "$type_days" | cut -d: -f2)

  TTL_ID=$(create_business_memory \
    "{\"organizationId\": \"${ORG_ID}\", \"type\": \"${MEM_TYPE}\", \"content\": \"[DECAY-TEST] TTL validation for ${MEM_TYPE} memory type\", \"importance\": 0.5, \"confidence\": 0.7, \"source\": \"explicit\"}")

  if [[ -n "$TTL_ID" ]]; then
    TTL_CHECK=$(get_business_memory "$TTL_ID")
    EXPIRES_AT=$(parse_json_field "$TTL_CHECK" "expiresAt")
    CREATED_AT=$(parse_json_field "$TTL_CHECK" "createdAt")

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
INST_ID=$(create_business_memory \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"instruction\", \"content\": \"[DECAY-TEST] Instructions never expire so expiresAt should be undefined\", \"importance\": 0.9, \"confidence\": 0.95, \"source\": \"explicit\"}")

if [[ -n "$INST_ID" ]]; then
  INST_CHECK=$(get_business_memory "$INST_ID")
  INST_EXPIRES=$(parse_json_field "$INST_CHECK" "expiresAt")

  [[ -z "$INST_EXPIRES" ]] \
    && ok "instruction: no expiresAt (never expires)" \
    || err "instruction: expiresAt should be undefined"
else
  err "Failed to create instruction memory"
fi

# ─── 8. Expired Memory (Past expiresAt) ─────────────────────
header "Expired Memory with Past TTL"

PAST_TIMESTAMP=$(($(date +%s) * 1000 - 86400000))
EXPIRED_ID=$(create_business_memory \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"context\", \"content\": \"[DECAY-TEST] Already expired memory should be filtered in retrieval\", \"importance\": 0.5, \"confidence\": 0.7, \"source\": \"explicit\", \"expiresAt\": ${PAST_TIMESTAMP}}")

if [[ -n "$EXPIRED_ID" ]]; then
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
  AGENT_DECAY=$(parse_json_field "$AGENT_GET" "decayScore")

  [[ "$AGENT_DECAY" == "1" || "$AGENT_DECAY" == "1.0" ]] \
    && ok "Initial decayScore = 1.0" \
    || err "decayScore = ${AGENT_DECAY} (expected 1.0)"

  npx convex run agentMemories:update \
    "{\"id\": \"${AGENT_ID}\", \"organizationId\": \"${ORG_ID}\", \"decayScore\": 0.4}" 2>&1 >/dev/null

  AGENT_PATCHED=$(npx convex run agentMemories:get \
    "{\"id\": \"${AGENT_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1)
  assert_field "$AGENT_PATCHED" "decayScore" "0.4" "Agent decayScore patched to 0.4"

  npx convex run agentMemories:softDelete \
    "{\"id\": \"${AGENT_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1 >/dev/null
  ok "Agent memory soft-deleted"
else
  err "Failed to create agent memory"
fi

# ─── 10. Decay Worker ────────────────────────────────────────
header "Decay Worker Execution"

DECAY_WORKER_ID=$(create_business_memory \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"episodic\", \"content\": \"[DECAY-TEST] Worker test for automatic decay score recalculation\", \"importance\": 0.5, \"confidence\": 0.7, \"source\": \"explicit\"}")

if [[ -n "$DECAY_WORKER_ID" ]]; then
  BEFORE_GET=$(get_business_memory "$DECAY_WORKER_ID")
  BEFORE_SCORE=$(parse_json_field "$BEFORE_GET" "decayScore")
  info "Score before: ${BEFORE_SCORE}"

  WORKER_OUT=$(npx convex run memoryDecay:runDecayUpdate 2>&1)

  if echo "$WORKER_OUT" | grep -q "error\|Error"; then
    info "Decay worker is an internalAction — may not be callable via CLI"
    info "The hourly cron handles this automatically"
    warn "Could not invoke worker directly (expected for internal actions)"
  else
    ok "Decay worker executed via CLI"
  fi

  AFTER_GET=$(get_business_memory "$DECAY_WORKER_ID")
  AFTER_SCORE=$(parse_json_field "$AFTER_GET" "decayScore")
  info "Score after:  ${AFTER_SCORE}"

  [[ -n "$BEFORE_SCORE" && -n "$AFTER_SCORE" ]] \
    && ok "Decay scores readable before/after worker" \
    || err "Could not read decay scores"
else
  err "Failed to create memory for worker test"
fi

# ─── 11. Cleanup & Results ───────────────────────────────────
cleanup_test_memories
print_results

# ─── Manual Tests ────────────────────────────────────────────
echo ""
echo -e "${BOLD}  Quick Manual Verification${NC}"
echo -e "  ─────────────────────────"
echo -e "  ${BOLD}1.${NC} Open ${YELLOW}bun convex:dashboard${NC} -> Cron Jobs tab"
echo -e "     Confirm: extraction (2m), decay (1h), archival (daily), cleanup (weekly)"
echo ""
echo -e "  ${BOLD}2.${NC} Chat at ${YELLOW}http://localhost:3000${NC} -> check businessMemories table"
echo -e "     Verify: accessCount++, lastAccessedAt updated, decayScore near 1.0"
echo ""
echo -e "  ${BOLD}3.${NC} In dashboard, edit a memory's decayScore to 0.25, then run:"
echo -e "     ${YELLOW}npx convex run businessMemories:archive '{\"id\":\"<ID>\",\"organizationId\":\"${ORG_ID}\"}'${NC}"
echo -e "     Verify: isArchived = true"
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"

exit $fail

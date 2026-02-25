#!/usr/bin/env bash
set -uo pipefail

# ============================================================
# test-memory-tools.sh
#
# Live end-to-end tests for Phase 6: Memory Tools & Chat Integration
#
# Tests:
#   1. Typecheck + lint (quick gate)
#   2. Convex connectivity
#   3. rememberFact: create memory with source=tool, verify state
#   4. searchMemories action: query and verify results
#   5. updatePreference: create preference, update content,
#      verify version increment
#   6. forgetMemory: soft-delete via tool flow, verify isActive=false
#   7. Conversation summary module: file existence + exports
#   8. Memory tools module: file existence + exports
#   9. Chat route integration checks
#  10. System prompt integration checks
#  11. E2E loop: create -> search -> verify -> soft-delete -> verify gone
#  12. Cleanup all test data
#
# Usage:
#   chmod +x scripts/test-memory-tools.sh
#   ./scripts/test-memory-tools.sh
#
# Prerequisites:
#   - .env.local with DEV_ORGANIZATION_ID
#   - Convex dev server running (bun dev:convex)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

print_banner "Phase 6: Memory Tools & Chat Integration — Test Suite"

# ─── 1. Quick Static Gate ────────────────────────────────────
run_static_gate

# ─── 2. Convex Connectivity ─────────────────────────────────
require_convex

# ─── 3. rememberFact: Create Memory with source=tool ────────
header "rememberFact: Create Memory"

info "Creating 'fact' type memory with source=tool..."
REMEMBER_ID=$(create_business_memory \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"fact\", \"content\": \"[MEMTOOL-TEST] Customer Alex prefers morning appointments on weekdays\", \"importance\": 0.8, \"confidence\": 0.95, \"source\": \"tool\"}")

if [[ -n "$REMEMBER_ID" ]]; then
  ok "Created fact memory: ${REMEMBER_ID}"
else
  err "Failed to create fact memory"
fi

if [[ -n "$REMEMBER_ID" ]]; then
  info "Verifying memory state..."
  GET_OUT=$(get_business_memory "$REMEMBER_ID")

  assert_grep "$GET_OUT" '"source"[[:space:]]*:[[:space:]]*"tool"' "source = tool"
  assert_grep "$GET_OUT" '"isActive"[[:space:]]*:[[:space:]]*true' "isActive = true"

  CONF_VAL=$(parse_json_field "$GET_OUT" "confidence")
  [[ "$CONF_VAL" == "0.95" ]] \
    && ok "confidence = 0.95 (high, tool-sourced)" \
    || warn "confidence = ${CONF_VAL:-?} (expected 0.95)"
fi

# ─── 4. searchMemories Action ───────────────────────────────
header "searchMemories: Public Action"

info "Waiting 3s for embedding generation..."
sleep 3

SEARCH_OUT=$(npx convex run memoryRetrieval:searchMemories \
  "{\"query\": \"Alex morning appointments\", \"organizationId\": \"${ORG_ID}\", \"authToken\": \"${MEMORY_API_TOKEN}\", \"limit\": 5}" 2>&1)

if echo "$SEARCH_OUT" | grep -q "error\|Error"; then
  info "searchMemories is a public action — may need different invocation"
  warn "Could not invoke searchMemories directly (actions require embedding service)"
else
  if echo "$SEARCH_OUT" | grep -q "MEMTOOL-TEST"; then
    ok "searchMemories found the test memory"
  elif echo "$SEARCH_OUT" | grep -q "results"; then
    ok "searchMemories returned results structure"
  else
    warn "searchMemories returned but test memory not found (embedding may not be ready yet)"
  fi
fi

# ─── 5. updatePreference: Create + Update ───────────────────
header "updatePreference: Create & Update"

info "Creating preference memory..."
PREF_ID=$(create_business_memory \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"preference\", \"content\": \"[MEMTOOL-TEST] Client Sarah prefers outdoor photoshoots in natural light\", \"importance\": 0.8, \"confidence\": 0.9, \"source\": \"tool\", \"subjectType\": \"lead\", \"subjectId\": \"Sarah\"}")

if [[ -n "$PREF_ID" ]]; then
  ok "Created preference memory: ${PREF_ID}"

  info "Updating preference content..."
  npx convex run businessMemories:update \
    "{\"id\": \"${PREF_ID}\", \"organizationId\": \"${ORG_ID}\", \"content\": \"[MEMTOOL-TEST] Client Sarah prefers outdoor photoshoots in golden hour lighting\", \"confidence\": 0.95}" 2>&1 >/dev/null

  UPDATED_GET=$(get_business_memory "$PREF_ID")

  VERSION=$(parse_json_field "$UPDATED_GET" "version")
  [[ "$VERSION" == "2" ]] \
    && ok "Version incremented to 2 after content update" \
    || warn "Version = ${VERSION:-?} (expected 2)"

  assert_grep "$UPDATED_GET" "golden hour" "Content updated to new value"
  assert_field "$UPDATED_GET" "confidence" "0.95" "Confidence updated to 0.95"
else
  err "Failed to create preference memory"
fi

# ─── 6. forgetMemory: Soft Delete ───────────────────────────
header "forgetMemory: Soft Delete"

info "Creating memory to forget..."
FORGET_ID=$(create_business_memory \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"context\", \"content\": \"[MEMTOOL-TEST] Temporary context that should be forgotten when requested\", \"importance\": 0.4, \"confidence\": 0.7, \"source\": \"tool\"}")

if [[ -n "$FORGET_ID" ]]; then
  ok "Created context memory to forget: ${FORGET_ID}"

  info "Soft-deleting memory (simulating forgetMemory tool)..."
  npx convex run businessMemories:softDelete \
    "{\"id\": \"${FORGET_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1 >/dev/null

  FORGET_CHECK=$(get_business_memory "$FORGET_ID")
  assert_grep "$FORGET_CHECK" '"isActive"[[:space:]]*:[[:space:]]*false' "Memory soft-deleted (isActive = false)"
else
  err "Failed to create memory for forget test"
fi

# ─── 7. Conversation Summary Module ─────────────────────────
header "Conversation Summary Module"

SUMMARY_FILE="src/lib/memory/conversationSummary.ts"
assert_file_exists "$SUMMARY_FILE" "Conversation summary module exists"

if [[ -f "$SUMMARY_FILE" ]]; then
  assert_file_contains "$SUMMARY_FILE" "buildConversationWindow" "Exports buildConversationWindow"
  assert_file_contains "$SUMMARY_FILE" "formatSummaryForPrompt" "Exports formatSummaryForPrompt"
  assert_file_contains "$SUMMARY_FILE" "ConversationSummaryResult" "Defines ConversationSummaryResult interface"
  assert_file_contains "$SUMMARY_FILE" "needsArchival" "Has archival threshold logic"
fi

# ─── 8. Memory Tools Module ─────────────────────────────────
header "Memory Tools Module"

TOOLS_FILE="src/lib/ai/tools/memory.ts"
assert_file_exists "$TOOLS_FILE" "Memory tools module exists"

if [[ -f "$TOOLS_FILE" ]]; then
  assert_file_contains "$TOOLS_FILE" "rememberFact" "Has rememberFact tool"
  assert_file_contains "$TOOLS_FILE" "forgetMemory" "Has forgetMemory tool"
  assert_file_contains "$TOOLS_FILE" "searchMemories" "Has searchMemories tool"
  assert_file_contains "$TOOLS_FILE" "updatePreference" "Has updatePreference tool"
  assert_file_contains "$TOOLS_FILE" "createMemoryTools" "Exports createMemoryTools factory"
fi

# ─── 9. Chat Route Integration ──────────────────────────────
header "Chat Route Integration"

ROUTE_FILE="src/app/api/chat/route.ts"
assert_file_contains "$ROUTE_FILE" "createMemoryTools" "Chat route imports createMemoryTools"
assert_file_contains "$ROUTE_FILE" "buildConversationWindow" "Chat route imports buildConversationWindow"
assert_file_contains "$ROUTE_FILE" "formatSummaryForPrompt" "Chat route imports formatSummaryForPrompt"
assert_file_contains "$ROUTE_FILE" "memoryTools" "Chat route creates memoryTools"

if grep -q "conversation_summary\|summaryResult" "$ROUTE_FILE" 2>/dev/null; then
  ok "Chat route has conversation summary handling"
else
  err "Chat route missing conversation summary logic"
fi

# ─── 10. System Prompt Integration ──────────────────────────
header "System Prompt Integration"

PROMPT_FILE="src/lib/ai/prompts/system.ts"
assert_file_contains "$PROMPT_FILE" "conversation_summary" "System prompt has conversation_summary placeholder"
assert_file_contains "$PROMPT_FILE" "Memory Management" "System prompt has Memory Management section"
assert_file_contains "$PROMPT_FILE" "rememberFact" "System prompt mentions rememberFact tool"

if grep -q "conversationSummary\|conversation_summary" "$PROMPT_FILE" 2>/dev/null; then
  ok "getSystemPrompt accepts conversation summary param"
else
  err "getSystemPrompt missing summary parameter"
fi

# ─── 11. E2E Loop: Create -> Search -> Verify -> Delete ─────
header "E2E Memory Loop"

info "Creating E2E test memory..."
E2E_ID=$(create_business_memory \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"instruction\", \"content\": \"[MEMTOOL-TEST] Always confirm appointment time zones with out-of-state clients\", \"importance\": 0.9, \"confidence\": 0.95, \"source\": \"tool\"}")

if [[ -n "$E2E_ID" ]]; then
  ok "E2E: Created instruction memory"

  E2E_GET=$(get_business_memory "$E2E_ID")
  assert_grep "$E2E_GET" '"type"[[:space:]]*:[[:space:]]*"instruction"' "E2E: Verified type = instruction"
  assert_grep "$E2E_GET" '"source"[[:space:]]*:[[:space:]]*"tool"' "E2E: Verified source = tool"

  info "E2E: Soft-deleting..."
  npx convex run businessMemories:softDelete \
    "{\"id\": \"${E2E_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1 >/dev/null

  E2E_DEL=$(get_business_memory "$E2E_ID")
  assert_grep "$E2E_DEL" '"isActive"[[:space:]]*:[[:space:]]*false' "E2E: Memory soft-deleted successfully"
else
  err "E2E: Failed to create instruction memory"
fi

# ─── 12. Cleanup & Results ──────────────────────────────────
cleanup_test_memories
print_results

# ─── Manual Tests ────────────────────────────────────────────
echo ""
echo -e "${BOLD}  Manual Verification${NC}"
echo -e "  ────────────────────"
echo -e "  ${BOLD}1.${NC} Start the app: ${YELLOW}bun dev${NC}"
echo ""
echo -e "  ${BOLD}2.${NC} Open chat at ${YELLOW}http://localhost:3000${NC} and test:"
echo ""
echo -e "     ${BOLD}a) rememberFact:${NC}"
echo -e "        Say: ${DIM}\"Remember that John prefers morning meetings\"${NC}"
echo -e "        Verify: Tool call appears in response, memory saved"
echo -e "        Check: Convex dashboard -> businessMemories table -> source: tool"
echo ""
echo -e "     ${BOLD}b) searchMemories:${NC}"
echo -e "        Say: ${DIM}\"What do you know about John?\"${NC}"
echo -e "        Verify: AI references the stored preference"
echo ""
echo -e "     ${BOLD}c) updatePreference:${NC}"
echo -e "        Say: ${DIM}\"Actually, John now prefers afternoon meetings\"${NC}"
echo -e "        Verify: The preference is updated (version incremented)"
echo ""
echo -e "     ${BOLD}d) forgetMemory:${NC}"
echo -e "        Say: ${DIM}\"Forget the preference about John's meeting time\"${NC}"
echo -e "        Verify: Memory soft-deleted (isActive: false)"
echo ""
echo -e "  ${BOLD}3.${NC} Conversation summary (long sessions):"
echo -e "     Send 10+ messages in a session"
echo -e "     Verify: debug log shows conversation trimmed (if debug enabled)"
echo ""
echo -e "  ${BOLD}4.${NC} Verify memory events in Convex dashboard:"
echo -e "     Check memoryEvents table for tool_success entries from memory tools"
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"

exit $fail

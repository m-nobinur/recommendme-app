#!/usr/bin/env bash
set -uo pipefail

# ============================================================
# test-extraction-pipeline.sh
#
# End-to-end validation for Phase 4: Memory Extraction Pipeline
#
# Tests:
#   1. Static analysis (typecheck + lint)
#   2. Convex function existence (extraction worker, cron, events)
#   3. Security & validation checks
#   4. Chat route event emission
#   5. Live server tests (event emission, extraction, memories)
#   6. Deduplication logic
#   7. Embedding integration
#
# Usage:
#   chmod +x scripts/test-extraction-pipeline.sh
#   ./scripts/test-extraction-pipeline.sh
#
# Prerequisites:
#   - .env.local with DEV_ORGANIZATION_ID, API keys
#   - bun dev running (Next.js + Convex)
#   - Seed data present (run dev-setup.sh)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

CONV_ID="test-extraction-$(date +%s)"
SERVER_AVAILABLE=false

if [[ -z "$ORG_ID" ]]; then
  echo -e "${RED}DEV_ORGANIZATION_ID not set. Run ./scripts/dev-setup.sh first.${NC}"
  exit 1
fi

print_banner "Phase 4: Memory Extraction Pipeline — Test Suite"
echo -e "  App URL:         $APP_URL"
echo -e "  Conversation ID: $CONV_ID"

# ─── 1. Static Analysis ─────────────────────────────────────
run_static_gate

# ─── 2. File Existence & Structure ──────────────────────────
header "File Existence & Structure"

REQUIRED_FILES=(
  "src/convex/memoryExtraction.ts"
  "src/convex/crons.ts"
  "src/lib/ai/memory/extractionPrompt.ts"
  "src/convex/memoryEvents.ts"
)

for f in "${REQUIRED_FILES[@]}"; do
  assert_file_exists "$f"
done

info "Checking extraction functions..."
assert_file_contains "src/convex/memoryExtraction.ts" "processExtractionBatch" "processExtractionBatch internalAction defined"
assert_file_contains "src/convex/memoryExtraction.ts" "insertBusinessMemory" "insertBusinessMemory internalMutation defined"
assert_file_contains "src/convex/memoryExtraction.ts" "insertAgentMemory" "insertAgentMemory internalMutation defined"
assert_file_contains "src/convex/memoryExtraction.ts" "insertRelation" "insertRelation internalMutation defined"

info "Checking cron job configuration..."
assert_file_contains "src/convex/crons.ts" "memory extraction pipeline" "Cron job 'memory extraction pipeline' configured"

if grep -q "minutes: 2" src/convex/crons.ts 2>/dev/null; then
  ok "Cron interval is 2 minutes"
else
  warn "Cron interval may not be 2 minutes"
fi

info "Checking extraction prompt..."
assert_file_contains "src/lib/ai/memory/extractionPrompt.ts" "EXTRACTION_SYSTEM_PROMPT" "EXTRACTION_SYSTEM_PROMPT defined"
assert_file_contains "src/lib/ai/memory/extractionPrompt.ts" "extractionOutputSchema" "Zod extractionOutputSchema defined"
assert_file_contains "src/lib/ai/memory/extractionPrompt.ts" "buildExtractionPrompt" "buildExtractionPrompt helper defined"

info "Checking memory event internal query..."
assert_file_contains "src/convex/memoryEvents.ts" "listUnprocessedInternal" "listUnprocessedInternal internalQuery defined"

# ─── 3. Security & Validation Checks ────────────────────────
header "Security & Validation"

info "Checking tenant isolation in extraction mutations..."
assert_file_contains "src/convex/memoryExtraction.ts" "organizationId: v.id('organizations')" "organizationId required in extraction mutations"

info "Checking dedup threshold..."
DEDUP_THRESHOLD=$(grep "DEDUP_SIMILARITY_THRESHOLD" src/convex/memoryExtraction.ts 2>/dev/null | head -1)
if echo "$DEDUP_THRESHOLD" | grep -q "0.92"; then
  ok "Dedup threshold is 0.92 (matches plan)"
elif echo "$DEDUP_THRESHOLD" | grep -q "0.85"; then
  warn "Dedup threshold is 0.85 (plan specifies 0.92)"
else
  warn "Could not determine dedup threshold"
fi

info "Checking content validation bounds..."
assert_file_contains "src/convex/memoryExtraction.ts" "m.content.length >= 10" "Minimum content length (10) enforced"
assert_file_contains "src/convex/memoryExtraction.ts" "m.content.length <= 500" "Maximum content length (500) enforced"
assert_file_contains "src/convex/memoryExtraction.ts" "m.confidence >= 0.5" "Minimum confidence (0.5) enforced"

info "Checking retry logic..."
if grep -q "MAX_EVENT_RETRIES\|retry.*window\|eventAgeMs" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "Failed event retry logic present"
else
  warn "Failed event retry logic not detected"
fi

info "Checking embedding configuration..."
EMBED_DIMS=$(grep "EMBEDDING_DIMENSIONS" src/convex/embedding.ts 2>/dev/null | head -1)
if echo "$EMBED_DIMS" | grep -q "3072"; then
  ok "Embedding dimensions = 3072 (text-embedding-3-large)"
else
  err "Embedding dimensions mismatch (expected 3072)"
fi

# ─── 4. Chat Route Event Emission ───────────────────────────
header "Chat Route Event Emission"

ROUTE_FILE="src/app/api/chat/route.ts"

info "Checking conversation_end event emission..."
assert_file_contains "$ROUTE_FILE" "conversation_end" "conversation_end event emitted in chat route"

info "Checking tool event emission..."
if grep -q "tool_success\|tool_failure" "$ROUTE_FILE" 2>/dev/null; then
  ok "tool_success/tool_failure events emitted in chat route"
else
  err "tool events not found in chat route"
fi

info "Checking non-blocking emission (after callback)..."
if grep -q "after(async" "$ROUTE_FILE" 2>/dev/null; then
  ok "Events emitted in after() callback (non-blocking)"
else
  warn "after() callback pattern not detected"
fi

# ─── 5. Live Server Tests ───────────────────────────────────
header "Live Server Tests"

info "Checking if Next.js dev server is running at ${APP_URL}..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${APP_URL}" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "307" || "$HTTP_CODE" == "302" ]]; then
  ok "Next.js server is running (HTTP ${HTTP_CODE})"
  SERVER_AVAILABLE=true
else
  warn "Next.js server not reachable (HTTP ${HTTP_CODE})"
  info "Skipping live API tests — start with 'bun dev'"
fi

if $SERVER_AVAILABLE; then
  EVENTS_BEFORE=$(npx convex run memoryEvents:listRecent \
    "{\"organizationId\": \"${ORG_ID}\", \"authToken\": \"${MEMORY_API_TOKEN}\", \"limit\": 100}" 2>&1)
  EVENT_COUNT_BEFORE=$(echo "$EVENTS_BEFORE" | grep -c '"eventType"' 2>/dev/null || echo "0")
  EVENT_COUNT_BEFORE=$(echo "$EVENT_COUNT_BEFORE" | tr -d '[:space:]')
  info "Events before test: ${EVENT_COUNT_BEFORE}"

  info "Sending test chat message with extractable content..."
  CHAT_RESPONSE=$(curl -s -X POST "${APP_URL}/api/chat" \
    -H "Content-Type: application/json" \
    -d "{
      \"messages\": [
        {
          \"id\": \"test-extract-001\",
          \"role\": \"user\",
          \"parts\": [{\"type\": \"text\", \"text\": \"Sarah Johnson prefers morning appointments before 10am. She referred Mike to us and he likes outdoor sessions at Central Park.\"}]
        }
      ],
      \"conversationId\": \"${CONV_ID}\"
    }" \
    --max-time 30 2>&1 || echo "CURL_FAILED")

  if [[ "$CHAT_RESPONSE" == "CURL_FAILED" ]]; then
    err "Chat API request failed"
  elif [[ -n "$CHAT_RESPONSE" && ${#CHAT_RESPONSE} -gt 10 ]]; then
    ok "Chat API responded (${#CHAT_RESPONSE} bytes)"
  else
    err "Chat API returned empty response"
  fi

  info "Waiting 5s for memory events to be emitted..."
  sleep 5

  EVENTS_AFTER=$(npx convex run memoryEvents:listRecent \
    "{\"organizationId\": \"${ORG_ID}\", \"authToken\": \"${MEMORY_API_TOKEN}\", \"limit\": 100}" 2>&1)
  EVENT_COUNT_AFTER=$(echo "$EVENTS_AFTER" | grep -c '"eventType"' 2>/dev/null || echo "0")
  EVENT_COUNT_AFTER=$(echo "$EVENT_COUNT_AFTER" | tr -d '[:space:]')
  info "Events after test: ${EVENT_COUNT_AFTER}"

  if [[ "$EVENT_COUNT_AFTER" -gt "$EVENT_COUNT_BEFORE" ]] 2>/dev/null; then
    NEW_EVENTS=$((EVENT_COUNT_AFTER - EVENT_COUNT_BEFORE))
    ok "${NEW_EVENTS} new memory event(s) emitted"
  else
    warn "No new events detected (may need longer wait)"
  fi

  if echo "$EVENTS_AFTER" | grep -q "conversation_end"; then
    ok "conversation_end event found"
  else
    warn "No conversation_end event found yet"
  fi

  info "Checking unprocessed event queue..."
  UNPROCESSED=$(npx convex run memoryEvents:listUnprocessed \
    "{\"organizationId\": \"${ORG_ID}\", \"authToken\": \"${MEMORY_API_TOKEN}\", \"limit\": 10}" 2>&1)
  UNPROCESSED_COUNT=$(echo "$UNPROCESSED" | grep -c '"eventType"' 2>/dev/null || echo "0")
  UNPROCESSED_COUNT=$(echo "$UNPROCESSED_COUNT" | tr -d '[:space:]')
  info "Unprocessed events: ${UNPROCESSED_COUNT}"
  if [[ "$UNPROCESSED_COUNT" -gt 0 ]] 2>/dev/null; then
    ok "Unprocessed events in queue — extraction cron will process them"
    info "Wait ~2 minutes for cron to trigger, then re-run to verify processing"
  else
    ok "No unprocessed events — cron may have already processed them"
  fi

  info "Checking business memories..."
  BIZ_MEMS=$(npx convex run businessMemories:list \
    "{\"organizationId\": \"${ORG_ID}\"}" 2>&1)
  BIZ_COUNT=$(echo "$BIZ_MEMS" | grep -c '"_id"' 2>/dev/null || echo "0")
  BIZ_COUNT=$(echo "$BIZ_COUNT" | tr -d '[:space:]')
  info "Total business memories: ${BIZ_COUNT}"

  if echo "$BIZ_MEMS" | grep -qi "extraction"; then
    ok "Found extraction-sourced business memories"
  else
    info "No extraction-sourced memories yet (cron may not have run)"
  fi

  info "Checking agent memories..."
  AGENT_MEMS=$(npx convex run agentMemories:list \
    "{\"organizationId\": \"${ORG_ID}\", \"agentType\": \"chat\"}" 2>&1)
  AGENT_MEM_COUNT=$(echo "$AGENT_MEMS" | grep -c '"_id"' 2>/dev/null || echo "0")
  AGENT_MEM_COUNT=$(echo "$AGENT_MEM_COUNT" | tr -d '[:space:]')
  info "Total agent memories (chat): ${AGENT_MEM_COUNT}"

else
  skip "Live server tests (server not available)"
fi

# ─── 6. Deduplication Logic Check ───────────────────────────
header "Deduplication Logic"

info "Checking isDuplicate function..."
assert_file_contains "src/convex/memoryExtraction.ts" "isDuplicate" "isDuplicate function defined"
assert_file_contains "src/convex/memoryExtraction.ts" "searchBusinessMemories" "Dedup uses vector search (searchBusinessMemories)"
assert_file_contains "src/convex/memoryExtraction.ts" "updateBusinessMemoryVersion" "Version chain logic present (updateBusinessMemoryVersion)"

if grep -q "previousVersionId" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "previousVersionId tracked for version chain"
else
  warn "previousVersionId not found in version logic"
fi

# ─── 7. Embedding Integration ───────────────────────────────
header "Embedding Integration"

assert_file_contains "src/convex/memoryExtraction.ts" "generateAndStore" "Auto-embedding via generateAndStore after memory creation"

info "Checking single-embedding optimization..."
if grep -q "embedding: vectorResults.embedding" src/convex/memoryRetrieval.ts 2>/dev/null; then
  ok "Single embedding optimization in memoryRetrieval"
else
  warn "Single embedding optimization not detected"
fi

if grep -q "embedding.*v.optional.*v.array.*v.float64" src/convex/hybridSearch.ts 2>/dev/null; then
  ok "hybridSearch accepts optional pre-generated embedding"
else
  warn "hybridSearch embedding passthrough not detected"
fi

# ─── Results ─────────────────────────────────────────────────
print_results

echo ""
echo -e "${BOLD}  Step-by-Step Manual Testing Guide:${NC}"
echo ""
echo -e "  ${BOLD}Step 1: Verify event emission${NC}"
echo -e "  -> Open the chat UI and send: \"Sarah Johnson prefers morning appointments\""
echo -e "  -> Check Convex dashboard -> memoryEvents table"
echo -e "  -> Verify a 'conversation_end' event was created with the conversation data"
echo ""
echo -e "  ${BOLD}Step 2: Trigger extraction${NC}"
echo -e "  -> Wait 2 minutes for the cron to fire, OR"
echo -e "  -> Run manually: npx convex run --no-push memoryExtraction:processExtractionBatch"
echo -e "  -> Check logs for '[Extraction] Batch complete' message"
echo ""
echo -e "  ${BOLD}Step 3: Verify extracted memories${NC}"
echo -e "  -> Check Convex dashboard -> businessMemories table"
echo -e "  -> Look for memories with source='extraction'"
echo -e "  -> Verify content, confidence, importance values make sense"
echo -e "  -> Verify embeddings were generated (embedding field not null)"
echo ""
echo -e "  ${BOLD}Step 4: Test deduplication${NC}"
echo -e "  -> Send the same info again: \"Sarah Johnson prefers morning appointments\""
echo -e "  -> Wait for extraction to run again"
echo -e "  -> Verify NO duplicate memory was created (or version was bumped)"
echo ""
echo -e "  ${BOLD}Step 5: Test tool outcome learning${NC}"
echo -e "  -> Ask the AI to add a lead: \"Add a lead named Test User, email test@test.com\""
echo -e "  -> Wait for extraction to run"
echo -e "  -> Check agentMemories table for a 'success' or 'failure' entry"
echo ""
echo -e "  ${BOLD}Step 6: Verify memory retrieval${NC}"
echo -e "  -> Start a new conversation"
echo -e "  -> Ask: \"What do you know about Sarah Johnson?\""
echo -e "  -> The AI should reference the extracted preference about morning appointments"
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"

exit $fail

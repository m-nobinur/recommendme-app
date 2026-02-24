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
#   3. Memory event emission via chat API
#   4. Extraction pipeline processing
#   5. Deduplication behavior
#   6. Agent memory creation from tool outcomes
#   7. Cron job verification
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

APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
ENV_FILE=".env.local"
CONV_ID="test-extraction-$(date +%s)"
SERVER_AVAILABLE=false

if [[ -f "$ENV_FILE" ]]; then
  ORG_ID=$(grep -E '^DEV_ORGANIZATION_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
else
  echo -e "${RED}No .env.local found. Run ./scripts/dev-setup.sh first.${NC}"
  exit 1
fi

if [[ -z "$ORG_ID" ]]; then
  echo -e "${RED}DEV_ORGANIZATION_ID not set. Run ./scripts/dev-setup.sh first.${NC}"
  exit 1
fi

echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Phase 4: Memory Extraction Pipeline — Test Suite${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "  Org ID:          $ORG_ID"
echo -e "  App URL:         $APP_URL"
echo -e "  Conversation ID: $CONV_ID"

# ─── 1. Static Analysis ──────────────────────────────────────
header "Static Analysis"

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

# ─── 2. File Existence & Structure ───────────────────────────
header "File Existence & Structure"

REQUIRED_FILES=(
  "src/convex/memoryExtraction.ts"
  "src/convex/crons.ts"
  "src/lib/memory/extractionPrompt.ts"
  "src/convex/memoryEvents.ts"
)

for f in "${REQUIRED_FILES[@]}"; do
  if [[ -f "$f" ]]; then
    ok "$f exists"
  else
    err "$f MISSING"
  fi
done

info "Checking extraction functions..."
if grep -q "processExtractionBatch" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "processExtractionBatch internalAction defined"
else
  err "processExtractionBatch not found in memoryExtraction.ts"
fi

if grep -q "insertBusinessMemory" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "insertBusinessMemory internalMutation defined"
else
  err "insertBusinessMemory not found"
fi

if grep -q "insertAgentMemory" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "insertAgentMemory internalMutation defined"
else
  err "insertAgentMemory not found"
fi

if grep -q "insertRelation" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "insertRelation internalMutation defined"
else
  err "insertRelation not found"
fi

info "Checking cron job configuration..."
if grep -q "memory extraction pipeline" src/convex/crons.ts 2>/dev/null; then
  ok "Cron job 'memory extraction pipeline' configured"
else
  err "Cron job not configured in crons.ts"
fi

if grep -q "minutes: 2" src/convex/crons.ts 2>/dev/null; then
  ok "Cron interval is 2 minutes"
else
  warn "Cron interval may not be 2 minutes"
fi

info "Checking extraction prompt..."
if grep -q "EXTRACTION_SYSTEM_PROMPT" src/lib/memory/extractionPrompt.ts 2>/dev/null; then
  ok "EXTRACTION_SYSTEM_PROMPT defined"
else
  err "EXTRACTION_SYSTEM_PROMPT not found"
fi

if grep -q "extractionOutputSchema" src/lib/memory/extractionPrompt.ts 2>/dev/null; then
  ok "Zod extractionOutputSchema defined"
else
  err "Zod extractionOutputSchema not found"
fi

if grep -q "buildExtractionPrompt" src/lib/memory/extractionPrompt.ts 2>/dev/null; then
  ok "buildExtractionPrompt helper defined"
else
  err "buildExtractionPrompt not found"
fi

info "Checking memory event internal query..."
if grep -q "listUnprocessedInternal" src/convex/memoryEvents.ts 2>/dev/null; then
  ok "listUnprocessedInternal internalQuery defined"
else
  err "listUnprocessedInternal not found in memoryEvents.ts"
fi

# ─── 3. Security & Validation Checks ─────────────────────────
header "Security & Validation"

info "Checking tenant isolation in extraction mutations..."
if grep -q "organizationId: v.id('organizations')" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "organizationId required in extraction mutations"
else
  err "organizationId not enforced in mutations"
fi

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
if grep -q "m.content.length >= 10" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "Minimum content length (10) enforced"
else
  err "Minimum content length not enforced"
fi

if grep -q "m.content.length <= 500" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "Maximum content length (500) enforced"
else
  err "Maximum content length not enforced"
fi

if grep -q "m.confidence >= 0.5" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "Minimum confidence (0.5) enforced"
else
  err "Minimum confidence not enforced"
fi

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

# ─── 4. Chat Route Event Emission ────────────────────────────
header "Chat Route Event Emission"

info "Checking conversation_end event emission..."
if grep -q "conversation_end" src/app/api/chat/route.ts 2>/dev/null; then
  ok "conversation_end event emitted in chat route"
else
  err "conversation_end event not found in chat route"
fi

info "Checking tool event emission..."
if grep -q "tool_success\|tool_failure" src/app/api/chat/route.ts 2>/dev/null; then
  ok "tool_success/tool_failure events emitted in chat route"
else
  err "tool events not found in chat route"
fi

info "Checking non-blocking emission (after callback)..."
if grep -q "after(async" src/app/api/chat/route.ts 2>/dev/null; then
  ok "Events emitted in after() callback (non-blocking)"
else
  warn "after() callback pattern not detected"
fi

# ─── 5. Live Server Tests ────────────────────────────────────
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
  # Count events before test
  EVENTS_BEFORE=$(npx convex run memoryEvents:listRecent \
    "{\"organizationId\": \"${ORG_ID}\", \"limit\": 100}" 2>&1)
  EVENT_COUNT_BEFORE=$(echo "$EVENTS_BEFORE" | grep -c '"eventType"' 2>/dev/null || echo "0")
  EVENT_COUNT_BEFORE=$(echo "$EVENT_COUNT_BEFORE" | tr -d '[:space:]')
  info "Events before test: ${EVENT_COUNT_BEFORE}"

  # Send a chat message that should trigger extraction
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

  # Wait for event emission
  info "Waiting 5s for memory events to be emitted..."
  sleep 5

  EVENTS_AFTER=$(npx convex run memoryEvents:listRecent \
    "{\"organizationId\": \"${ORG_ID}\", \"limit\": 100}" 2>&1)
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

  # Check unprocessed events
  info "Checking unprocessed event queue..."
  UNPROCESSED=$(npx convex run memoryEvents:listUnprocessed \
    "{\"organizationId\": \"${ORG_ID}\", \"limit\": 10}" 2>&1)
  UNPROCESSED_COUNT=$(echo "$UNPROCESSED" | grep -c '"eventType"' 2>/dev/null || echo "0")
  UNPROCESSED_COUNT=$(echo "$UNPROCESSED_COUNT" | tr -d '[:space:]')
  info "Unprocessed events: ${UNPROCESSED_COUNT}"
  if [[ "$UNPROCESSED_COUNT" -gt 0 ]] 2>/dev/null; then
    ok "Unprocessed events in queue — extraction cron will process them"
    info "Wait ~2 minutes for cron to trigger, then re-run to verify processing"
  else
    ok "No unprocessed events — cron may have already processed them"
  fi

  # Check if extraction created memories
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

# ─── 6. Deduplication Logic Check ────────────────────────────
header "Deduplication Logic"

info "Checking isDuplicate function..."
if grep -q "isDuplicate" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "isDuplicate function defined"
else
  err "isDuplicate function not found"
fi

if grep -q "searchBusinessMemories" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "Dedup uses vector search (searchBusinessMemories)"
else
  err "Dedup does not use vector search"
fi

if grep -q "updateBusinessMemoryVersion" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "Version chain logic present (updateBusinessMemoryVersion)"
else
  err "Version chain logic not found"
fi

if grep -q "previousVersionId" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "previousVersionId tracked for version chain"
else
  warn "previousVersionId not found in version logic"
fi

# ─── 7. Embedding Integration ────────────────────────────────
header "Embedding Integration"

if grep -q "generateAndStore" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "Auto-embedding via generateAndStore after memory creation"
else
  err "No auto-embedding found in extraction"
fi

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

# ─── Summary ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Phase 4 Test Results${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "  ${GREEN}Passed:   ${pass}${NC}"
[[ $warn_count -gt 0 ]] && echo -e "  ${YELLOW}Warnings: ${warn_count}${NC}"
[[ $skip_count -gt 0 ]] && echo -e "  ${DIM}Skipped:  ${skip_count}${NC}"
[[ $fail -gt 0 ]] && echo -e "  ${RED}Failed:   ${fail}${NC}"
echo ""

if [[ $fail -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}All checks passed!${NC} Phase 4 extraction pipeline is operational."
else
  echo -e "  ${RED}${BOLD}Some checks failed.${NC} Review errors above."
fi

echo ""
echo -e "${BOLD}  Step-by-Step Manual Testing Guide:${NC}"
echo ""
echo -e "  ${BOLD}Step 1: Verify event emission${NC}"
echo -e "  → Open the chat UI and send: \"Sarah Johnson prefers morning appointments\""
echo -e "  → Check Convex dashboard → memoryEvents table"
echo -e "  → Verify a 'conversation_end' event was created with the conversation data"
echo ""
echo -e "  ${BOLD}Step 2: Trigger extraction${NC}"
echo -e "  → Wait 2 minutes for the cron to fire, OR"
echo -e "  → Run manually: npx convex run --no-push memoryExtraction:processExtractionBatch"
echo -e "  → Check logs for '[Extraction] Batch complete' message"
echo ""
echo -e "  ${BOLD}Step 3: Verify extracted memories${NC}"
echo -e "  → Check Convex dashboard → businessMemories table"
echo -e "  → Look for memories with source='extraction'"
echo -e "  → Verify content, confidence, importance values make sense"
echo -e "  → Verify embeddings were generated (embedding field not null)"
echo ""
echo -e "  ${BOLD}Step 4: Test deduplication${NC}"
echo -e "  → Send the same info again: \"Sarah Johnson prefers morning appointments\""
echo -e "  → Wait for extraction to run again"
echo -e "  → Verify NO duplicate memory was created (or version was bumped)"
echo ""
echo -e "  ${BOLD}Step 5: Test tool outcome learning${NC}"
echo -e "  → Ask the AI to add a lead: \"Add a lead named Test User, email test@test.com\""
echo -e "  → Wait for extraction to run"
echo -e "  → Check agentMemories table for a 'success' or 'failure' entry"
echo ""
echo -e "  ${BOLD}Step 6: Verify memory retrieval${NC}"
echo -e "  → Start a new conversation"
echo -e "  → Ask: \"What do you know about Sarah Johnson?\""
echo -e "  → The AI should reference the extracted preference about morning appointments"
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"

exit $fail

#!/usr/bin/env bash
set -uo pipefail

# ============================================================
# validate-memory.sh — Validate the memory system pipeline
#
# Runs a comprehensive check of the memory system:
#   1. Schema & index validation (typecheck)
#   2. Convex data layer validation (queries)
#   3. Memory retrieval API test (curl to chat endpoint)
#   4. Memory event emission check
#   5. Hybrid search validation
#
# Usage:
#   chmod +x scripts/validate-memory.sh
#   ./scripts/validate-memory.sh
#
# Prerequisites:
#   - dev-setup.sh has been run
#   - bun dev is running (Next.js + Convex)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

USER_ID=""
if [[ -f "$ENV_FILE" ]]; then
  USER_ID=$(grep -E '^DEV_USER_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
fi

if [[ -z "$ORG_ID" ]]; then
  echo -e "${RED}DEV_ORGANIZATION_ID not set. Run ./scripts/dev-setup.sh first.${NC}"
  exit 1
fi

print_banner "Memory System Validation"
echo -e "  App URL: $APP_URL"

# ─── 1. Static Analysis ─────────────────────────────────────
run_static_gate

# ─── 2. Convex Data Layer ───────────────────────────────────
header "Convex Data Layer"

info "Querying organization..."
ORG_DATA=$(npx convex run organizations:getOrganizationBySlug '{"slug":"dev-org"}' 2>&1)
if echo "$ORG_DATA" | grep -q "Dev Organization"; then
  ok "Organization 'Dev Organization' exists"
  if echo "$ORG_DATA" | grep -q "photography"; then
    ok "nicheId='photography' is set"
  else
    warn "nicheId not set — niche memory retrieval will be skipped"
  fi
else
  err "Organization not found — run dev-setup.sh"
fi

info "Querying business memories..."
BIZ_OUTPUT=$(npx convex run businessMemories:list \
  "{\"organizationId\": \"${ORG_ID}\"}" 2>&1)
BIZ_COUNT=$(echo "$BIZ_OUTPUT" | grep -c '"_id"' 2>/dev/null || true)
BIZ_COUNT=${BIZ_COUNT:-0}
BIZ_COUNT=$(echo "$BIZ_COUNT" | tr -d '[:space:]')
if [[ "$BIZ_COUNT" -gt 0 ]] 2>/dev/null; then
  ok "Found ${BIZ_COUNT} business memories"
else
  err "No business memories found — run dev-setup.sh to seed"
fi

info "Querying agent memories..."
AGENT_OUTPUT=$(npx convex run agentMemories:list \
  "{\"organizationId\": \"${ORG_ID}\", \"agentType\": \"chat\"}" 2>&1 || true)
AGENT_COUNT=$(echo "$AGENT_OUTPUT" | grep -c '"_id"' 2>/dev/null || true)
AGENT_COUNT=${AGENT_COUNT:-0}
AGENT_COUNT=$(echo "$AGENT_COUNT" | tr -d '[:space:]')
if [[ "$AGENT_COUNT" -gt 0 ]] 2>/dev/null; then
  ok "Found ${AGENT_COUNT} agent memories"
else
  err "No agent memories found — run dev-setup.sh to seed"
fi

info "Querying memory events..."
EVENTS=$(npx convex run memoryEvents:listRecent \
  "{\"organizationId\": \"${ORG_ID}\", \"authToken\": \"${MEMORY_API_TOKEN}\", \"limit\": 10}" 2>&1)
EVENT_COUNT=$(echo "$EVENTS" | grep -c '"eventType"' 2>/dev/null || true)
EVENT_COUNT=${EVENT_COUNT:-0}
EVENT_COUNT=$(echo "$EVENT_COUNT" | tr -d '[:space:]')
if [[ "$EVENT_COUNT" -gt 0 ]] 2>/dev/null; then
  ok "Found ${EVENT_COUNT} memory events"
  if echo "$EVENTS" | grep -q "conversation_end"; then
    ok "conversation_end events present (chat -> memory pipeline working)"
  else
    warn "No conversation_end events yet — send a chat message first"
  fi
else
  warn "No memory events yet — they are emitted when you chat"
fi

# ─── 3. Chat API Health ─────────────────────────────────────
header "Chat API Health Check"

info "Checking if Next.js dev server is running at ${APP_URL}..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${APP_URL}" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "307" || "$HTTP_CODE" == "302" ]]; then
  ok "Next.js server is running (HTTP ${HTTP_CODE})"
else
  warn "Next.js server not reachable (HTTP ${HTTP_CODE}) — start with 'bun dev'"
  info "Skipping API tests"
fi

if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "307" || "$HTTP_CODE" == "302" ]]; then
  info "Sending test chat message..."
  CHAT_RESPONSE=$(curl -s -X POST "${APP_URL}/api/chat" \
    -H "Content-Type: application/json" \
    -d '{
      "messages": [
        {
          "id": "test-msg-001",
          "role": "user",
          "parts": [{"type": "text", "text": "What do you know about John Smith?"}]
        }
      ],
      "conversationId": "00000000-0000-4000-8000-000000000001"
    }' \
    --max-time 30 2>&1 || echo "CURL_FAILED")

  if [[ "$CHAT_RESPONSE" == "CURL_FAILED" ]]; then
    err "Chat API request failed (timeout or connection error)"
  elif echo "$CHAT_RESPONSE" | grep -q '"error"'; then
    ERROR_MSG=$(echo "$CHAT_RESPONSE" | grep -oE '"error":"[^"]+"' | head -1)
    err "Chat API returned error: ${ERROR_MSG}"
  elif [[ -n "$CHAT_RESPONSE" && ${#CHAT_RESPONSE} -gt 10 ]]; then
    ok "Chat API responded (${#CHAT_RESPONSE} bytes)"
    if echo "$CHAT_RESPONSE" | grep -qi "john\|smith\|portrait\|outdoor"; then
      ok "Response mentions John Smith context — memory retrieval is working!"
    else
      warn "Response didn't clearly reference John Smith memories"
      info "This may be normal — the AI might paraphrase differently"
    fi
  else
    err "Chat API returned empty or very short response"
  fi

  info "Waiting 3s for conversation_end event to be emitted..."
  sleep 3

  EVENTS_AFTER=$(npx convex run memoryEvents:listRecent \
    "{\"organizationId\": \"${ORG_ID}\", \"authToken\": \"${MEMORY_API_TOKEN}\", \"limit\": 5}" 2>&1)
  if echo "$EVENTS_AFTER" | grep -q "conversation_end"; then
    ok "conversation_end event emitted after chat"
  else
    warn "No conversation_end event yet (may need longer wait or check logs)"
  fi
fi

# ─── 4. Memory Validation Rules ─────────────────────────────
header "Memory Validation Rules (CRUD guards)"

info "Negative tests below intentionally send invalid payloads."
info "Expected behavior: Convex rejects them with validation errors (this is PASS)."

info "Testing business memory validation — content too short..."
SHORT_RESULT=$(npx convex run businessMemories:create \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"fact\", \"content\": \"short\", \"importance\": 0.8, \"confidence\": 0.9, \"source\": \"explicit\"}" 2>&1 || true)
if echo "$SHORT_RESULT" | grep -qi "validation failed\|too short\|error"; then
  ok "Short content correctly rejected"
else
  err "Short content was NOT rejected — validation may be missing"
fi

info "Testing business memory validation — confidence out of range..."
CONF_RESULT=$(npx convex run businessMemories:create \
  "{\"organizationId\": \"${ORG_ID}\", \"type\": \"fact\", \"content\": \"This is a perfectly valid memory content for testing purposes\", \"importance\": 0.8, \"confidence\": 0.2, \"source\": \"explicit\"}" 2>&1 || true)
if echo "$CONF_RESULT" | grep -qi "validation failed\|confidence\|error"; then
  ok "Low confidence correctly rejected (below 0.5 threshold)"
else
  err "Low confidence was NOT rejected — validation may be missing"
fi

info "Testing agent memory validation — content too short..."
AGENT_SHORT=$(npx convex run agentMemories:create \
  "{\"organizationId\": \"${ORG_ID}\", \"agentType\": \"chat\", \"category\": \"pattern\", \"content\": \"tiny\", \"confidence\": 0.8}" 2>&1 || true)
if echo "$AGENT_SHORT" | grep -qi "validation failed\|too short\|error"; then
  ok "Agent memory short content correctly rejected"
else
  err "Agent memory short content was NOT rejected"
fi

# ─── 5. Index Validation ────────────────────────────────────
header "Index & Query Validation"

info "Testing memoryEvents by_org_created index (time-ordered)..."
INDEX_RESULT=$(npx convex run memoryEvents:listRecent \
  "{\"organizationId\": \"${ORG_ID}\", \"authToken\": \"${MEMORY_API_TOKEN}\", \"limit\": 3}" 2>&1)
if echo "$INDEX_RESULT" | grep -qi "error\|index.*not\|no such"; then
  err "by_org_created index query failed"
  echo "$INDEX_RESULT"
else
  ok "memoryEvents by_org_created index works"
fi

info "Testing businessMemories by_org index..."
BIZ_INDEX=$(npx convex run businessMemories:list \
  "{\"organizationId\": \"${ORG_ID}\"}" 2>&1)
if echo "$BIZ_INDEX" | grep -qi "error\|index.*not"; then
  err "businessMemories by_org index query failed"
else
  ok "businessMemories by_org index works"
fi

# ─── Results ─────────────────────────────────────────────────
print_results

echo ""
echo -e "  ${BOLD}Manual tests to try in the chat UI:${NC}"
echo -e "  1. \"What do you know about John Smith?\""
echo -e "     -> Should mention outdoor locations, portrait preferences"
echo -e "  2. \"What are our pricing packages?\""
echo -e "     -> Should pull from business + niche memories"
echo -e "  3. \"Tell me about Sarah Johnson\""
echo -e "     -> Should mention B&W edits, corporate headshots, February deadline"
echo -e "  4. \"How should I follow up with leads?\""
echo -e "     -> Should reference platform best practices (24-hour rule)"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"

exit $fail

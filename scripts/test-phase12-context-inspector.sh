#!/usr/bin/env bash
# ============================================================
# Phase 12.9: Context Inspector Wiring Validation
# Static checks only — no live Convex server required.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

print_banner "Phase 12.9: Context Inspector Wiring"

CHAT_ROUTE="src/app/api/chat/route.ts"
RETRIEVAL="src/lib/ai/memory/retrieval.ts"
CHAT_CONTAINER="src/app/(dashboard)/chat/components/ChatContainer.tsx"
HISTORY_ROUTE="src/app/api/chat/history/route.ts"
MESSAGES="src/convex/messages.ts"
SCHEMA="src/convex/schema.ts"
INSPECTOR="src/components/memory/ContextInspector.tsx"

header "Core Wiring"
assert_file_contains "$CHAT_ROUTE" "messageMetadata" "Chat route emits message metadata"
assert_file_contains "$CHAT_ROUTE" "retrievalTrace" "Chat route attaches retrievalTrace"
assert_file_contains "$CHAT_ROUTE" "metadata:" "Assistant persistence includes metadata"

header "Retrieval Payload"
assert_file_contains "$RETRIEVAL" "InspectorData" "Retrieval exports InspectorData"
assert_file_contains "$RETRIEVAL" "inspectorData" "Retrieval returns inspectorData"
assert_file_contains "$RETRIEVAL" "tokenBudget: selected.budgetUsage.totalBudget" "Inspector token budget uses dynamic allocation"
assert_file_contains "$RETRIEVAL" "tokensUsed: selected.budgetUsage.totalUsed" "Inspector token usage uses selected budget usage"

header "Frontend Integration"
assert_file_contains "$CHAT_CONTAINER" "ContextInspector" "ChatContainer mounts ContextInspector"
assert_file_contains "$CHAT_CONTAINER" "retrievalTrace" "ChatContainer reads retrievalTrace metadata"
assert_file_contains "$INSPECTOR" "InspectorMemory" "ContextInspector reuses shared InspectorMemory type"

header "Persistence + History"
assert_file_contains "$MESSAGES" "retrievalTrace" "messages.save validator accepts retrievalTrace"
assert_file_contains "$SCHEMA" "retrievalTrace" "schema messages metadata includes retrievalTrace"
assert_file_contains "$HISTORY_ROUTE" "retrievalTrace" "History route returns retrievalTrace"

header "Validation Gate"
if bun run check:all >/dev/null 2>&1; then
  ok "Full validation gate passes (check:all)"
else
  err "Full validation gate failed (check:all)"
fi

print_results
exit $fail

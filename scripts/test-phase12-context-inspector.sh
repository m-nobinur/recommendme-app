#!/usr/bin/env bash
# test-phase12-context-inspector.sh
# Phase 12.9 — ContextInspector Live Wiring — Static validation script
#
# Checks that all wiring points for the ContextInspector are in place:
#   1. InspectorMemory + InspectorData exported from retrieval.ts
#   2. inspectorData built inside retrieveMemoryContext (env-gated)
#   3. messageMetadata callback present in route.ts
#   4. ContextInspector imported + rendered in ChatContainer.tsx
#   5. RetrievedMemory.id widened to string in ContextInspector.tsx
#   6. TypeScript build is clean

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0

green() { printf '\033[32m✓ %s\033[0m\n' "$1"; }
red()   { printf '\033[31m✗ %s\033[0m\n' "$1"; }

check() {
  local desc="$1"
  local file="$2"
  local pattern="$3"
  if grep -qE "$pattern" "$file" 2>/dev/null; then
    green "$desc"
    PASS=$((PASS + 1))
  else
    red "$desc"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Phase 12.9 — ContextInspector Live Wiring — Validation"
echo "═══════════════════════════════════════════════════════════"
echo ""

RETRIEVAL="$ROOT/src/lib/ai/memory/retrieval.ts"
ROUTE="$ROOT/src/app/api/chat/route.ts"
CONTAINER="$ROOT/src/app/(dashboard)/chat/components/ChatContainer.tsx"
INSPECTOR="$ROOT/src/components/memory/ContextInspector.tsx"

# ── retrieval.ts ──────────────────────────────────────────────
check "InspectorMemory interface exported"        "$RETRIEVAL" "export interface InspectorMemory"
check "InspectorData interface exported"          "$RETRIEVAL" "export interface InspectorData"
check "inspectorData field on RetrievalResult"    "$RETRIEVAL" "inspectorData\?:.*InspectorData"
check "inspectorData env-gate present"            "$RETRIEVAL" "NEXT_PUBLIC_SHOW_CONTEXT_INSPECTOR"
check "INSPECTOR_MAX_MEMORIES cap applied"        "$RETRIEVAL" "INSPECTOR_MAX_MEMORIES"
check "inspectorData assigned to result"          "$RETRIEVAL" "inspectorData,"

# ── route.ts ─────────────────────────────────────────────────
check "messageMetadata callback in route.ts"      "$ROUTE"     "messageMetadata"
check "retrievalTrace emitted on finish"          "$ROUTE"     "retrievalTrace"
check "finish part-type guard present"            "$ROUTE"     "part\.type.*finish"

# ── ChatContainer.tsx ────────────────────────────────────────
check "ContextInspector imported"                 "$CONTAINER" "import.*ContextInspector"
check "InspectorData type imported"               "$CONTAINER" "import.*InspectorData"
check "isInspectorData runtime guard defined"     "$CONTAINER" "function isInspectorData"
check "lastAssistantTrace memo defined"           "$CONTAINER" "lastAssistantTrace"
check "ContextInspector rendered conditionally"   "$CONTAINER" "<ContextInspector"

# ── ContextInspector.tsx ──────────────────────────────────────
check "RetrievedMemory.id widened to string"      "$INSPECTOR" "id: string"
# Verify Convex Id import was removed (no longer needed)
if ! grep -q "Id<'businessMemories'>" "$INSPECTOR" 2>/dev/null; then
  green "Convex branded-id import removed from ContextInspector"
  PASS=$((PASS + 1))
else
  red "ContextInspector still references Id<'businessMemories'>"
  FAIL=$((FAIL + 1))
fi

# ── TypeScript build ──────────────────────────────────────────
echo ""
echo "Running TypeScript check..."
if (cd "$ROOT" && bun run typecheck > /dev/null 2>&1); then
  green "TypeScript: no type errors"
  PASS=$((PASS + 1))
else
  red "TypeScript: type errors detected — run 'bun run typecheck' for details"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "───────────────────────────────────────────────────────────"
echo "  Results: ${PASS} passed, ${FAIL} failed"
echo "───────────────────────────────────────────────────────────"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

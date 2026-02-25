#!/usr/bin/env bash
# ============================================================
# scripts/test-agent-framework.sh
#
# Functional validation for the Agent Framework (Phase 7).
#
# Tests:
#   1. Static validation (typecheck + lint)
#   2. Unit tests (bun test for agent framework test files)
#   3. Schema & index validation
#   4. Cron wiring
#   5. Module exports & public API
#   6. Config integrity (followup config matches guardrails contract)
#   7. Shared module deduplication
#   8. Convex LLM provider
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

echo -e "\n${BOLD}${BLUE}═══════════════════════════════════════════${NC}"
echo -e "${BOLD}  Agent Framework Validation (Phase 7)${NC}"
echo -e "${BOLD}${BLUE}═══════════════════════════════════════════${NC}"

# ── 1. Static Validation ──────────────────────────────────────

header "Static Validation"

info "Running TypeScript type check..."
if bun run typecheck > /dev/null 2>&1; then
  ok "TypeScript type check passed"
else
  err "TypeScript type check failed"
fi

info "Running Biome lint..."
if bun run lint > /dev/null 2>&1; then
  ok "Biome lint passed"
else
  err "Biome lint failed"
fi

# ── 2. Unit Tests ─────────────────────────────────────────────

header "Unit Tests"

info "Running agent framework unit tests..."
TEST_OUTPUT=$(bun test src/lib/ai/agents/ src/convex/agentExecutions.test.ts src/convex/agentLogic/followup.test.ts 2>&1)
TEST_EXIT=$?

if [[ $TEST_EXIT -eq 0 ]]; then
  ok "All agent framework unit tests passed"
  TEST_COUNT=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ pass' | head -1)
  if [[ -n "$TEST_COUNT" ]]; then
    info "$TEST_COUNT"
  fi
else
  err "Agent framework unit tests failed"
  echo "$TEST_OUTPUT" | tail -20
fi

# ── 3. Schema & Index Validation ─────────────────────────────

header "Schema & Index Validation"

assert_file_contains "src/convex/schema.ts" "agentDefinitions:" \
  "agentDefinitions table defined in schema"

assert_file_contains "src/convex/schema.ts" "agentExecutions:" \
  "agentExecutions table defined in schema"

assert_file_contains "src/convex/schema.ts" "by_org_agent" \
  "by_org_agent index defined"

assert_file_contains "src/convex/schema.ts" "by_org_agent_status" \
  "by_org_agent_status index defined"

assert_file_contains "src/convex/schema.ts" "by_org_enabled" \
  "by_org_enabled index defined for agentDefinitions"

assert_file_contains "src/convex/schema.ts" "by_agent_enabled" \
  "by_agent_enabled index defined for global enabled-by-type lookups"

# ── 4. Cron Wiring ───────────────────────────────────────────

header "Cron Wiring"

assert_file_contains "src/convex/crons.ts" "runFollowupAgent" \
  "Followup agent cron triggers runFollowupAgent"

CRON_REF=$(grep -c "agentRunner" src/convex/crons.ts 2>/dev/null || echo 0)
if [[ "$CRON_REF" -ge 1 ]]; then
  ok "Cron file references agentRunner module"
else
  err "Cron file does not reference agentRunner module"
fi

# ── 5. Module Exports & Public API ───────────────────────────

header "Module Exports & Public API"

# Registry functions
assert_file_contains "src/lib/ai/agents/registry.ts" "getAgentHandler" \
  "getAgentHandler exported from registry"
assert_file_contains "src/lib/ai/agents/registry.ts" "getRegisteredAgentTypes" \
  "getRegisteredAgentTypes exported from registry"
assert_file_contains "src/lib/ai/agents/registry.ts" "isAgentImplemented" \
  "isAgentImplemented exported from registry"

# Core interfaces
assert_file_contains "src/lib/ai/agents/core/handler.ts" "AgentHandler" \
  "AgentHandler interface exported from core"

# Agent barrel wired into AI barrel
assert_file_contains "src/lib/ai/index.ts" "getAgentHandler" \
  "Agent registry wired into AI barrel export"

# Shared module wired into AI barrel
assert_file_contains "src/lib/ai/index.ts" "getApi" \
  "Shared getApi wired into AI barrel export"
assert_file_contains "src/lib/ai/index.ts" "asOrganizationId" \
  "Shared asOrganizationId wired into AI barrel"

# Memory module wired into AI barrel
assert_file_contains "src/lib/ai/index.ts" "retrieveMemoryContext" \
  "Memory retrieval wired into AI barrel"

# Types exported from types/index
assert_file_contains "src/types/index.ts" "AgentType" \
  "AgentType exported from types/index"
assert_file_contains "src/types/index.ts" "AgentConfig" \
  "AgentConfig exported from types/index"

# ── 6. Config Integrity ──────────────────────────────────────

header "Config Integrity"

# Followup config has all required sections
assert_file_contains "src/lib/ai/agents/followup/config.ts" "FOLLOWUP_CONFIG" \
  "FOLLOWUP_CONFIG exported"
assert_file_contains "src/convex/agentLogic/followup.ts" "allowedActions" \
  "Followup config defines allowedActions"
assert_file_contains "src/convex/agentLogic/followup.ts" "riskOverrides" \
  "Followup config defines riskOverrides"
assert_file_contains "src/convex/agentLogic/followup.ts" "maxActionsPerRun" \
  "Followup config defines maxActionsPerRun"

# Followup tools whitelist
assert_file_contains "src/lib/ai/agents/followup/tools.ts" "FOLLOWUP_ACTIONS" \
  "Followup actions whitelist exported"

# Config/tools alignment is validated by unit tests (handler.test.ts)
# Verify the FOLLOWUP_ACTIONS array and FOLLOWUP_CONFIG.guardrails.allowedActions
# both contain the same three action types
if grep -q "update_lead_notes" src/lib/ai/agents/followup/tools.ts 2>/dev/null &&
   grep -q "update_lead_status" src/lib/ai/agents/followup/tools.ts 2>/dev/null &&
   grep -q "log_recommendation" src/lib/ai/agents/followup/tools.ts 2>/dev/null; then
  ok "Followup tools handles all three action types"
else
  err "Followup tools missing action type handlers"
fi

# ── 7. Shared Module Deduplication ───────────────────────────

header "Shared Module Deduplication"

# shared/convex.ts is the single source of getApi
assert_file_contains "src/lib/ai/shared/convex.ts" "getApi" \
  "getApi defined in shared/convex.ts"
assert_file_contains "src/lib/ai/shared/convex.ts" "asOrganizationId" \
  "asOrganizationId defined in shared/convex.ts"

# No local getApi in consumers (they should import from shared)
if ! grep -q "let cachedApiPromise" src/lib/ai/tools/index.ts 2>/dev/null; then
  ok "tools/index.ts has no local getApi (uses shared)"
else
  err "tools/index.ts still has local getApi definition"
fi

if ! grep -q "let cachedApiPromise" src/lib/ai/tools/memory.ts 2>/dev/null; then
  ok "tools/memory.ts has no local getApi (uses shared)"
else
  err "tools/memory.ts still has local getApi definition"
fi

if ! grep -q "let cachedApiPromise" src/lib/ai/agents/core/memory.ts 2>/dev/null; then
  ok "agents/core/memory.ts has no local getApi (uses shared)"
else
  err "agents/core/memory.ts still has local getApi definition"
fi

if ! grep -q "let cachedApiPromise" src/lib/ai/agents/followup/handler.ts 2>/dev/null; then
  ok "followup/handler.ts has no local getApi (uses shared)"
else
  err "followup/handler.ts still has local getApi definition"
fi

if ! grep -q "let cachedApiPromise" src/lib/ai/agents/followup/tools.ts 2>/dev/null; then
  ok "followup/tools.ts has no local getApi (uses shared)"
else
  err "followup/tools.ts still has local getApi definition"
fi

# No stale @/lib/memory imports anywhere
if ! grep -rq "@/lib/memory" src/ --include="*.ts" 2>/dev/null; then
  ok "No stale @/lib/memory imports found"
else
  err "Found files with stale @/lib/memory imports"
fi

# ── 8. Convex LLM Provider ──────────────────────────────────

header "Convex LLM Provider"

assert_file_contains "src/convex/llmProvider.ts" "resolveLLMProvider" \
  "resolveLLMProvider exported from llmProvider.ts"
assert_file_contains "src/convex/llmProvider.ts" "callLLM" \
  "callLLM exported from llmProvider.ts"
assert_file_contains "src/convex/llmProvider.ts" "ResolvedLLMProvider" \
  "ResolvedLLMProvider type exported"

# agentRunner imports from llmProvider
assert_file_contains "src/convex/agentRunner.ts" "./llmProvider" \
  "agentRunner imports from llmProvider"

# No local LLM_PROVIDERS in agentRunner
if ! grep -q "const LLM_PROVIDERS" src/convex/agentRunner.ts 2>/dev/null; then
  ok "agentRunner has no local LLM_PROVIDERS (uses shared)"
else
  err "agentRunner still has local LLM_PROVIDERS"
fi

# memoryExtraction imports from llmProvider
assert_file_contains "src/convex/memoryExtraction.ts" "./llmProvider" \
  "memoryExtraction imports from llmProvider"

if ! grep -q "const LLM_PROVIDERS" src/convex/memoryExtraction.ts 2>/dev/null; then
  ok "memoryExtraction has no local LLM_PROVIDERS (uses shared)"
else
  err "memoryExtraction still has local LLM_PROVIDERS"
fi

# memoryArchival imports from llmProvider
assert_file_contains "src/convex/memoryArchival.ts" "./llmProvider" \
  "memoryArchival imports from llmProvider"

if ! grep -q "const LLM_PROVIDERS" src/convex/memoryArchival.ts 2>/dev/null; then
  ok "memoryArchival has no local LLM_PROVIDERS (uses shared)"
else
  err "memoryArchival still has local LLM_PROVIDERS"
fi

# ── 9. Tenant Isolation Hardening ───────────────────────────

header "Tenant Isolation Hardening"

assert_file_contains "src/convex/leads.ts" "organizationId: v.id('organizations')" \
  "leads mutation/query arguments include organizationId"

assert_file_contains "src/convex/leads.ts" "Lead not found or access denied" \
  "leads update/get/remove enforce org ownership"

assert_file_contains "src/convex/agentRunner.ts" "organizationId: v.id('organizations')" \
  "agentRunner internal lead mutations require organizationId"

assert_file_contains "src/convex/agentRunner.ts" "Lead does not belong to this organization" \
  "agentRunner lead updates enforce org ownership"

assert_file_contains "src/lib/ai/agents/followup/tools.ts" "asOrganizationId(context.organizationId)" \
  "followup tools pass organizationId to secured lead mutations"

assert_file_contains "src/convex/agentDefinitions.ts" "Only organization owners/admins can manage agents" \
  "agentDefinitions mutations enforce owner/admin role for agent management"

# ── Results ───────────────────────────────────────────────────

print_results

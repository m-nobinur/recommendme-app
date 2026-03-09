#!/usr/bin/env bash
# ============================================================
# scripts/test-reminder-agent.sh
#
# Functional validation for the Reminder Agent (Phase 7b).
#
# Tests:
#   1. Static validation (typecheck + lint)
#   2. File structure & module existence
#   3. Handler exports & public API
#   4. Config integrity (allowed actions, risk levels)
#   5. Prompt builder & plan validator contracts
#   6. Registry integration (reminder handler registered)
#   7. Cron registration
#   8. Runner wiring (runReminderAgent + helpers)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

echo -e "\n${BOLD}${BLUE}═══════════════════════════════════════════${NC}"
echo -e "${BOLD}  Reminder Agent Validation (Phase 7b)${NC}"
echo -e "${BOLD}${BLUE}═══════════════════════════════════════════${NC}"

# ── 1. Static Validation ──────────────────────────────────────

header "Static Validation"

info "Running TypeScript type check..."
if bun run typecheck > /dev/null 2>&1; then
  ok "TypeScript type check passed"
else
  err "TypeScript type check failed"
fi

info "Running Biome lint + format..."
if bun run check:ci > /dev/null 2>&1; then
  ok "Biome CI check passed"
else
  err "Biome CI check failed"
fi

# ── 2. File Structure ──────────────────────────────────────────

header "File Structure"

assert_file_exists "src/convex/agentLogic/reminder.ts"
assert_file_exists "src/lib/ai/agents/reminder/handler.ts"
assert_file_exists "src/lib/ai/agents/reminder/prompt.ts"
assert_file_exists "src/lib/ai/agents/reminder/tools.ts"
assert_file_exists "src/lib/ai/agents/reminder/config.ts"
assert_file_exists "src/lib/ai/agents/reminder/index.ts"

# ── 3. Handler Exports & Public API ───────────────────────────

header "Handler Exports"

assert_file_contains "src/lib/ai/agents/reminder/index.ts" \
  "ReminderHandler" \
  "index.ts exports ReminderHandler"

assert_file_contains "src/lib/ai/agents/reminder/index.ts" \
  "REMINDER_CONFIG" \
  "index.ts exports REMINDER_CONFIG"

assert_file_contains "src/lib/ai/agents/reminder/index.ts" \
  "REMINDER_SYSTEM_PROMPT" \
  "index.ts exports REMINDER_SYSTEM_PROMPT"

assert_file_contains "src/lib/ai/agents/reminder/index.ts" \
  "buildReminderUserPrompt" \
  "index.ts exports buildReminderUserPrompt"

assert_file_contains "src/lib/ai/agents/reminder/index.ts" \
  "executeReminderAction" \
  "index.ts exports executeReminderAction"

assert_file_contains "src/lib/ai/agents/reminder/index.ts" \
  "REMINDER_ACTIONS" \
  "index.ts exports REMINDER_ACTIONS"

assert_file_contains "src/lib/ai/agents/reminder/index.ts" \
  "DEFAULT_REMINDER_SETTINGS" \
  "index.ts exports DEFAULT_REMINDER_SETTINGS"

# ── 4. Config Integrity ───────────────────────────────────────

header "Config Integrity"

assert_file_contains "src/convex/agentLogic/reminder.ts" \
  "agentType: 'reminder'" \
  "REMINDER_CONFIG.agentType = 'reminder'"

assert_file_contains "src/convex/agentLogic/reminder.ts" \
  "triggerType: 'cron'" \
  "REMINDER_CONFIG.triggerType = 'cron'"

assert_file_contains "src/convex/agentLogic/reminder.ts" \
  "defaultRiskLevel: 'low'" \
  "REMINDER_CONFIG.defaultRiskLevel = 'low'"

assert_file_contains "src/convex/agentLogic/reminder.ts" \
  "update_appointment_notes" \
  "Config allows update_appointment_notes"

assert_file_contains "src/convex/agentLogic/reminder.ts" \
  "update_lead_notes" \
  "Config allows update_lead_notes"

assert_file_contains "src/convex/agentLogic/reminder.ts" \
  "log_reminder_recommendation" \
  "Config allows log_reminder_recommendation"

assert_file_contains "src/convex/agentLogic/reminder.ts" \
  "maxActionsPerRun: 20" \
  "Config limits maxActionsPerRun to 20"

assert_file_contains "src/convex/agentLogic/reminder.ts" \
  "requireApprovalAbove: 'high'" \
  "Config requireApprovalAbove = 'high'"

# ── 5. Prompt & Validator Contracts ───────────────────────────

header "Prompt & Validator Contracts"

assert_file_contains "src/convex/agentLogic/reminder.ts" \
  "buildReminderUserPromptFromData" \
  "Shared prompt builder exported"

assert_file_contains "src/convex/agentLogic/reminder.ts" \
  "validateReminderPlan" \
  "Shared plan validator exported"

assert_file_contains "src/convex/agentLogic/reminder.ts" \
  "ReminderAppointmentData" \
  "ReminderAppointmentData interface defined"

assert_file_contains "src/convex/agentLogic/reminder.ts" \
  "ReminderLeadData" \
  "ReminderLeadData interface defined"

assert_file_contains "src/convex/agentLogic/reminder.ts" \
  "ReminderMemoryData" \
  "ReminderMemoryData interface defined"

assert_file_contains "src/convex/agentLogic/reminder.ts" \
  "REMINDER_SYSTEM_PROMPT" \
  "REMINDER_SYSTEM_PROMPT defined"

# ── 6. Handler Implementation ─────────────────────────────────

header "Handler Implementation"

assert_file_contains "src/lib/ai/agents/reminder/handler.ts" \
  "implements AgentHandler" \
  "ReminderHandler implements AgentHandler"

assert_file_contains "src/lib/ai/agents/reminder/handler.ts" \
  "loadContext" \
  "Handler has loadContext()"

assert_file_contains "src/lib/ai/agents/reminder/handler.ts" \
  "buildPlanPrompt" \
  "Handler has buildPlanPrompt()"

assert_file_contains "src/lib/ai/agents/reminder/handler.ts" \
  "validatePlan" \
  "Handler has validatePlan()"

assert_file_contains "src/lib/ai/agents/reminder/handler.ts" \
  "executeAction" \
  "Handler has executeAction()"

assert_file_contains "src/lib/ai/agents/reminder/handler.ts" \
  "async learn" \
  "Handler has learn()"

assert_file_contains "src/lib/ai/agents/reminder/handler.ts" \
  "recordLearning" \
  "Handler uses recordLearning for memory"

# ── 7. Tools Implementation ───────────────────────────────────

header "Tools Implementation"

assert_file_contains "src/lib/ai/agents/reminder/tools.ts" \
  "update_appointment_notes" \
  "Tools handle update_appointment_notes"

assert_file_contains "src/lib/ai/agents/reminder/tools.ts" \
  "update_lead_notes" \
  "Tools handle update_lead_notes"

assert_file_contains "src/lib/ai/agents/reminder/tools.ts" \
  "log_reminder_recommendation" \
  "Tools handle log_reminder_recommendation"

assert_file_contains "src/lib/ai/agents/reminder/tools.ts" \
  '\[Reminder' \
  "Tools add [Reminder] marker for idempotency"

# ── 8. Registry Integration ───────────────────────────────────

header "Registry Integration"

assert_file_contains "src/lib/ai/agents/registry.ts" \
  "ReminderHandler" \
  "Registry imports ReminderHandler"

if grep -q "reminder.*new ReminderHandler" src/lib/ai/agents/registry.ts 2>/dev/null; then
  ok "Registry maps 'reminder' to ReminderHandler"
else
  err "Registry does not map 'reminder' to ReminderHandler"
fi

if grep -q "throw.*Reminder agent not yet implemented" src/lib/ai/agents/registry.ts 2>/dev/null; then
  err "Registry still throws 'not yet implemented' for reminder"
else
  ok "Registry no longer throws for reminder agent"
fi

# ── 9. Cron Registration ──────────────────────────────────────

header "Cron Registration"

assert_file_contains "src/convex/crons.ts" \
  "reminder agent" \
  "Cron job 'reminder agent' registered"

assert_file_contains "src/convex/crons.ts" \
  "runReminderAgent" \
  "Cron calls runReminderAgent"

if grep -q "hourUTC: 9" src/convex/crons.ts 2>/dev/null; then
  ok "Reminder cron scheduled at 09:00 UTC"
else
  err "Reminder cron not at expected time (09:00 UTC)"
fi

# ── 10. Runner Wiring ─────────────────────────────────────────

header "Runner Wiring"

assert_file_contains "src/convex/agentRunner.ts" \
  "runReminderAgent" \
  "agentRunner exports runReminderAgent"

assert_file_contains "src/convex/agentRunner.ts" \
  "getUpcomingAppointmentsForReminder" \
  "agentRunner has getUpcomingAppointmentsForReminder query"

assert_file_contains "src/convex/agentRunner.ts" \
  "updateAppointmentNotes" \
  "agentRunner has updateAppointmentNotes mutation"

assert_file_contains "src/convex/agentRunner.ts" \
  "getLeadsByIds" \
  "agentRunner has getLeadsByIds query"

assert_file_contains "src/convex/agentRunner.ts" \
  "buildReminderUserPromptFromData" \
  "Runner uses reminder prompt builder"

assert_file_contains "src/convex/agentRunner.ts" \
  "validateReminderPlan" \
  "Runner uses reminder plan validator"

assert_file_contains "src/convex/agentRunner.ts" \
  "REMINDER_CONFIG" \
  "Runner uses REMINDER_CONFIG for guardrails"

if grep -q "v.literal('reminder')" src/convex/agentRunner.ts 2>/dev/null; then
  ok "runAgentForOrg accepts 'reminder' agent type"
else
  err "runAgentForOrg does not accept 'reminder' agent type"
fi

# ── 11. Idempotency Check ─────────────────────────────────────

header "Idempotency"

assert_file_contains "src/lib/ai/agents/reminder/handler.ts" \
  "\\[Reminder" \
  "Handler filters out already-reminded appointments via [Reminder] marker"

assert_file_contains "src/convex/agentRunner.ts" \
  "\\[Reminder" \
  "Runner checks [Reminder] marker for idempotency"

# ── 12. Top-Level Barrel Export ────────────────────────────────

header "Top-Level Barrel Export"

assert_file_contains "src/lib/ai/agents/index.ts" \
  "ReminderHandler" \
  "agents/index.ts exports ReminderHandler"

assert_file_contains "src/lib/ai/agents/index.ts" \
  "REMINDER_CONFIG" \
  "agents/index.ts exports REMINDER_CONFIG"

assert_file_contains "src/lib/ai/agents/index.ts" \
  "ReminderAgentSettings" \
  "agents/index.ts exports ReminderAgentSettings type"

assert_file_contains "src/convex/agentLogic/index.ts" \
  "reminder" \
  "agentLogic/index.ts re-exports reminder module"

# ── Results ────────────────────────────────────────────────────

print_results
exit $fail

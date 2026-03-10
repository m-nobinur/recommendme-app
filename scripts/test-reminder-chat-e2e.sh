#!/usr/bin/env bash
# ============================================================
# scripts/test-reminder-chat-e2e.sh
#
# End-to-end validation for the Reminder Chat Integration.
#
# Tests:
#   Part A: Static validation (typecheck + lint)
#   Part B: Unit tests (timezone, chat tools, agent runner)
#   Part C: Timezone utility correctness
#   Part D: Structural integration (schema, routes, prompts)
#   Part E: Convex live tests (create lead + appointment,
#           set reminder, verify, list, cleanup)
#
# Requires:
#   - bun, npx convex, .env.local with DEV_ORGANIZATION_ID
#   - Convex dev server running (bun dev:convex)
#   - For Section E: DEV_USER_ID in .env.local
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/test-helpers.sh"

# ── Extra env ────────────────────────────────────────────────
DEV_USER_ID=""
if [[ -f "$ENV_FILE" ]]; then
  DEV_USER_ID=$(grep -E '^DEV_USER_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
fi

# Track appointment IDs for cleanup
_APPT_IDS_FILE=$(mktemp)
_LEAD_IDS_FILE=$(mktemp)
trap 'rm -f "$_APPT_IDS_FILE" "$_LEAD_IDS_FILE" "$_TEST_IDS_FILE" "$_TEST_AGENT_IDS_FILE"' EXIT

track_appt_id() { [[ -n "${1:-}" ]] && echo "$1" >> "$_APPT_IDS_FILE"; }
track_lead_id() { [[ -n "${1:-}" ]] && echo "$1" >> "$_LEAD_IDS_FILE"; }

print_banner "Reminder Chat Integration E2E"

# ══════════════════════════════════════════════════════════════
# Part A: Static Validation
# ══════════════════════════════════════════════════════════════

run_static_gate

# ══════════════════════════════════════════════════════════════
# Part B: Unit Tests
# ══════════════════════════════════════════════════════════════

header "Timezone Utility Unit Tests"
TZ_OUT=$(bun test src/lib/ai/shared/timezone.test.ts 2>&1)
TZ_EXIT=$?
if [[ $TZ_EXIT -eq 0 ]]; then
  ok "All timezone utility tests passed"
  TZ_COUNT=$(echo "$TZ_OUT" | grep -oE '[0-9]+ pass' | head -1)
  [[ -n "$TZ_COUNT" ]] && info "$TZ_COUNT"
else
  err "Timezone utility tests failed"
  echo "$TZ_OUT" | tail -20
fi

header "Reminder Chat Tool Unit Tests"
TOOL_OUT=$(bun test src/lib/ai/tools/reminder.test.ts 2>&1)
TOOL_EXIT=$?
if [[ $TOOL_EXIT -eq 0 ]]; then
  ok "All reminder chat tool tests passed"
  TOOL_COUNT=$(echo "$TOOL_OUT" | grep -oE '[0-9]+ pass' | head -1)
  [[ -n "$TOOL_COUNT" ]] && info "$TOOL_COUNT"
else
  err "Reminder chat tool tests failed"
  echo "$TOOL_OUT" | tail -20
fi

header "Agent Runner Reminder Unit Tests"
RUNNER_OUT=$(bun test src/convex/agentRunner.reminder.test.ts 2>&1)
RUNNER_EXIT=$?
if [[ $RUNNER_EXIT -eq 0 ]]; then
  ok "All agent runner reminder tests passed"
  RUNNER_COUNT=$(echo "$RUNNER_OUT" | grep -oE '[0-9]+ pass' | head -1)
  [[ -n "$RUNNER_COUNT" ]] && info "$RUNNER_COUNT"
else
  err "Agent runner reminder tests failed"
  echo "$RUNNER_OUT" | tail -20
fi

# ══════════════════════════════════════════════════════════════
# Part C: Timezone Structural Validation
# ══════════════════════════════════════════════════════════════

header "Timezone Infrastructure"

assert_file_exists "src/lib/ai/shared/timezone.ts" \
  "Timezone utility exists (Next.js side)"

assert_file_exists "src/convex/lib/timezone.ts" \
  "Timezone utility exists (Convex side)"

assert_file_contains "src/convex/schema.ts" \
  "timezone" \
  "Organization schema includes timezone field"

assert_file_contains "src/convex/organizations.ts" \
  "timezone" \
  "Organization settings mutation accepts timezone"

header "Timezone Usage in Appointments"

assert_file_contains "src/convex/appointments.ts" \
  "resolveTimezone" \
  "Appointments imports resolveTimezone"

assert_file_contains "src/convex/appointments.ts" \
  "todayInTimezone" \
  "Appointments uses todayInTimezone for date computation"

assert_file_contains "src/convex/appointments.ts" \
  'timezone: v.optional(v.string())' \
  "setReminderNote accepts optional timezone arg"

header "Timezone Usage in Agent Runner"

assert_file_contains "src/convex/agentRunner.ts" \
  "resolveTimezone" \
  "Agent runner imports resolveTimezone"

assert_file_contains "src/convex/agentRunner.ts" \
  "todayInTimezone" \
  "Agent runner uses todayInTimezone"

assert_file_contains "src/convex/agentRunner.ts" \
  "epochToDateInTimezone" \
  "Agent runner uses epochToDateInTimezone"

assert_file_contains "src/convex/agentRunner.ts" \
  "getOrgTimezone" \
  "Agent runner has getOrgTimezone query"

assert_file_contains "src/convex/agentRunner.ts" \
  "appointmentToEpoch" \
  "Agent runner uses timezone-aware appointmentToEpoch"

header "Timezone in Chat Route"

assert_file_contains "src/app/api/chat/route.ts" \
  "timezone" \
  "Chat route extracts timezone from org settings"

assert_file_contains "src/lib/ai/tools/index.ts" \
  "timezone" \
  "ToolContext has timezone field"

assert_file_contains "src/lib/ai/tools/reminder.ts" \
  "timezone" \
  "Reminder tools pass timezone to Convex mutations"

header "Timezone in Handler"

assert_file_contains "src/lib/ai/agents/reminder/handler.ts" \
  "resolveTimezone" \
  "Handler imports resolveTimezone"

assert_file_contains "src/lib/ai/agents/reminder/handler.ts" \
  "appointmentToEpoch" \
  "Handler uses timezone-aware appointmentToEpoch"

# ══════════════════════════════════════════════════════════════
# Part D: Chat Integration Structural Checks
# ══════════════════════════════════════════════════════════════

header "Chat Tool Structure"

assert_file_contains "src/lib/ai/tools/reminder.ts" \
  "setReminder" \
  "setReminder tool defined"

assert_file_contains "src/lib/ai/tools/reminder.ts" \
  "listReminders" \
  "listReminders tool defined"

assert_file_contains "src/lib/ai/tools/index.ts" \
  "createReminderTools" \
  "Tools barrel exports createReminderTools"

assert_file_contains "src/app/api/chat/route.ts" \
  "createReminderTools" \
  "Chat route imports createReminderTools"

assert_file_contains "src/lib/ai/prompts/system.ts" \
  "setReminder" \
  "System prompt documents setReminder"

assert_file_contains "src/lib/ai/prompts/system.ts" \
  "listReminders" \
  "System prompt documents listReminders"

header "Convex Public Reminder API"

assert_file_contains "src/convex/appointments.ts" \
  "setReminderNote" \
  "setReminderNote mutation exists"

assert_file_contains "src/convex/appointments.ts" \
  "setReminderByLeadName" \
  "setReminderByLeadName mutation exists"

assert_file_contains "src/convex/appointments.ts" \
  "getAppointmentsWithReminders" \
  "getAppointmentsWithReminders query exists"

# ══════════════════════════════════════════════════════════════
# Part E: Live Convex E2E Tests
# ══════════════════════════════════════════════════════════════

header "Convex Connectivity"
if [[ -z "$ORG_ID" ]] || [[ -z "$DEV_USER_ID" ]]; then
  skip "Live E2E tests (need DEV_ORGANIZATION_ID and DEV_USER_ID in .env.local)"
else
  CONN_CHECK=$(npx convex run appointments:list \
    "{\"userId\": \"${DEV_USER_ID}\", \"organizationId\": \"${ORG_ID}\"}" 2>&1)
  if echo "$CONN_CHECK" | grep -q "error\|Error\|ECONNREFUSED"; then
    skip "Live E2E tests (Convex dev server not reachable — start with: bun dev:convex)"
  else
    ok "Convex dev server connected"

    # ── E2E Step 1: Create test lead ──────────────────────────
    header "E2E: Create Test Lead"

    LEAD_OUT=$(npx convex run leads:create \
      "{\"organizationId\": \"${ORG_ID}\", \"userId\": \"${DEV_USER_ID}\", \"name\": \"[E2E-TEST] Jane Reminder\", \"phone\": \"555-0199\", \"tags\": [\"e2e-test\"]}" 2>&1)
    LEAD_ID=$(echo "$LEAD_OUT" | tr -d '"' | tr -d ' ' | grep -E '^[a-z0-9]{20,}$' | head -1)
    if [[ -z "$LEAD_ID" ]]; then
      LEAD_ID=$(extract_id "$LEAD_OUT")
    fi

    if [[ -n "$LEAD_ID" ]]; then
      ok "Created test lead: $LEAD_ID"
      track_lead_id "$LEAD_ID"
    else
      err "Failed to create test lead"
      info "$LEAD_OUT"
    fi

    # ── E2E Step 2: Create test appointment ───────────────────
    header "E2E: Create Test Appointment"

    TOMORROW=$(date -v+1d +%Y-%m-%d 2>/dev/null || date -d "+1 day" +%Y-%m-%d 2>/dev/null || echo "2026-03-11")

    if [[ -n "$LEAD_ID" ]]; then
      APPT_OUT=$(npx convex run appointments:create \
        "{\"organizationId\": \"${ORG_ID}\", \"userId\": \"${DEV_USER_ID}\", \"leadId\": \"${LEAD_ID}\", \"leadName\": \"[E2E-TEST] Jane Reminder\", \"date\": \"${TOMORROW}\", \"time\": \"14:00\", \"title\": \"E2E Reminder Test\"}" 2>&1)
      APPT_ID=$(echo "$APPT_OUT" | tr -d '"' | tr -d ' ' | grep -E '^[a-z0-9]{20,}$' | head -1)
      if [[ -z "$APPT_ID" ]]; then
        APPT_ID=$(extract_id "$APPT_OUT")
      fi

      if [[ -n "$APPT_ID" ]]; then
        ok "Created test appointment: $APPT_ID (${TOMORROW} 14:00)"
        track_appt_id "$APPT_ID"
      else
        err "Failed to create test appointment"
        info "$APPT_OUT"
      fi
    else
      skip "Appointment creation (no lead ID)"
    fi

    # ── E2E Step 3: Set reminder via Convex mutation ──────────
    header "E2E: Set Reminder"

    if [[ -n "$APPT_ID" ]]; then
      REMINDER_OUT=$(npx convex run appointments:setReminderNote \
        "{\"userId\": \"${DEV_USER_ID}\", \"organizationId\": \"${ORG_ID}\", \"appointmentId\": \"${APPT_ID}\", \"reminderMessage\": \"E2E test: bring portfolio samples\"}" 2>&1)

      assert_grep "$REMINDER_OUT" '"success"[[:space:]]*:[[:space:]]*true' \
        "setReminderNote returned success"
      assert_grep "$REMINDER_OUT" 'Jane Reminder' \
        "setReminderNote returned correct lead name"
      assert_grep "$REMINDER_OUT" "$TOMORROW" \
        "setReminderNote returned correct date"
    else
      skip "Set reminder (no appointment ID)"
    fi

    # ── E2E Step 4: Verify reminder note on appointment ───────
    header "E2E: Verify Reminder Note"

    if [[ -n "$APPT_ID" ]]; then
      APPT_GET=$(npx convex run appointments:get \
        "{\"userId\": \"${DEV_USER_ID}\", \"organizationId\": \"${ORG_ID}\", \"id\": \"${APPT_ID}\"}" 2>&1)

      assert_grep "$APPT_GET" '\[Reminder' \
        "Appointment notes contain [Reminder marker"
      assert_grep "$APPT_GET" 'portfolio samples' \
        "Appointment notes contain reminder message"
    else
      skip "Verify reminder (no appointment ID)"
    fi

    # ── E2E Step 5: Set reminder by lead name ─────────────────
    header "E2E: Set Reminder By Lead Name"

    if [[ -n "$LEAD_ID" ]]; then
      BYNAME_OUT=$(npx convex run appointments:setReminderByLeadName \
        "{\"userId\": \"${DEV_USER_ID}\", \"organizationId\": \"${ORG_ID}\", \"leadName\": \"Jane Reminder\", \"reminderMessage\": \"E2E test: confirm meeting time\"}" 2>&1)

      assert_grep "$BYNAME_OUT" '"success"[[:space:]]*:[[:space:]]*true' \
        "setReminderByLeadName returned success"
      assert_grep "$BYNAME_OUT" 'Jane Reminder' \
        "setReminderByLeadName fuzzy-matched lead name"
    else
      skip "Set reminder by name (no lead ID)"
    fi

    # ── E2E Step 6: Verify second reminder appended ───────────
    header "E2E: Verify Multiple Reminders"

    if [[ -n "$APPT_ID" ]]; then
      APPT_GET2=$(npx convex run appointments:get \
        "{\"userId\": \"${DEV_USER_ID}\", \"organizationId\": \"${ORG_ID}\", \"id\": \"${APPT_ID}\"}" 2>&1)

      assert_grep "$APPT_GET2" 'portfolio samples' \
        "First reminder still present"
      assert_grep "$APPT_GET2" 'confirm meeting time' \
        "Second reminder appended"

      MARKER_COUNT=$(echo "$APPT_GET2" | grep -o '\[Reminder' | wc -l | tr -d ' ')
      if [[ "$MARKER_COUNT" -ge 2 ]]; then
        ok "Both reminder markers present (found $MARKER_COUNT)"
      else
        err "Expected 2+ [Reminder markers, found $MARKER_COUNT"
      fi
    else
      skip "Verify multiple reminders (no appointment ID)"
    fi

    # ── E2E Step 7: List appointments with reminders ──────────
    header "E2E: List Reminders"

    LIST_OUT=$(npx convex run appointments:getAppointmentsWithReminders \
      "{\"userId\": \"${DEV_USER_ID}\", \"organizationId\": \"${ORG_ID}\", \"now\": $(date +%s000)}" 2>&1)

    if echo "$LIST_OUT" | grep -q 'Jane Reminder'; then
      ok "getAppointmentsWithReminders includes test appointment"
    else
      err "getAppointmentsWithReminders missing test appointment"
      info "$LIST_OUT" | head -5
    fi

    # ── E2E Step 8: Idempotency check — cancelled appointments ─
    header "E2E: Edge Cases"

    if [[ -n "$APPT_ID" ]]; then
      npx convex run appointments:update \
        "{\"userId\": \"${DEV_USER_ID}\", \"organizationId\": \"${ORG_ID}\", \"id\": \"${APPT_ID}\", \"status\": \"cancelled\"}" 2>&1 >/dev/null

      CANCEL_OUT=$(npx convex run appointments:setReminderNote \
        "{\"userId\": \"${DEV_USER_ID}\", \"organizationId\": \"${ORG_ID}\", \"appointmentId\": \"${APPT_ID}\", \"reminderMessage\": \"Should fail\"}" 2>&1)

      assert_grep "$CANCEL_OUT" '"success"[[:space:]]*:[[:space:]]*false' \
        "setReminderNote rejects cancelled appointment"
      assert_grep "$CANCEL_OUT" 'cancelled' \
        "Error message mentions cancelled status"
    else
      skip "Edge case tests (no appointment ID)"
    fi

    # ── E2E Cleanup ───────────────────────────────────────────
    header "E2E: Cleanup"

    CLEANED=0
    if [[ -s "$_APPT_IDS_FILE" ]]; then
      while IFS= read -r appt_id; do
        if [[ -n "$appt_id" ]]; then
          npx convex run appointments:remove \
            "{\"userId\": \"${DEV_USER_ID}\", \"organizationId\": \"${ORG_ID}\", \"id\": \"${appt_id}\"}" 2>&1 >/dev/null || true
          CLEANED=$((CLEANED + 1))
        fi
      done < "$_APPT_IDS_FILE"
    fi
    if [[ -s "$_LEAD_IDS_FILE" ]]; then
      while IFS= read -r lead_id; do
        if [[ -n "$lead_id" ]]; then
          npx convex run leads:remove \
            "{\"userId\": \"${DEV_USER_ID}\", \"organizationId\": \"${ORG_ID}\", \"id\": \"${lead_id}\"}" 2>&1 >/dev/null || true
          CLEANED=$((CLEANED + 1))
        fi
      done < "$_LEAD_IDS_FILE"
    fi
    ok "Cleaned up $CLEANED test records"
  fi
fi

# ══════════════════════════════════════════════════════════════
# Results
# ══════════════════════════════════════════════════════════════

print_results

# ══════════════════════════════════════════════════════════════
# Manual Testing Recommendations
# ══════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}  Manual Testing Guide${NC}"
echo -e "  ────────────────────"
echo ""
echo -e "  ${BOLD}Prerequisites:${NC}"
echo -e "  -> Start the app: ${YELLOW}bun dev${NC}"
echo -e "  -> Ensure you have a lead with a scheduled appointment in the CRM"
echo ""
echo -e "  ${BOLD}Step 1: Set Timezone${NC}"
echo -e "  -> Open Convex dashboard: ${YELLOW}bun convex:dashboard${NC}"
echo -e "  -> Find your organization in the ${YELLOW}organizations${NC} table"
echo -e "  -> Edit settings and add: ${DIM}\"timezone\": \"America/New_York\"${NC} (or your timezone)"
echo -e "  -> Verify: reminder markers should now show dates in your local timezone"
echo ""
echo -e "  ${BOLD}Step 2: Set Reminder via Chat${NC}"
echo -e "  -> Open chat at ${YELLOW}http://localhost:3000${NC}"
echo -e "  -> Say: ${DIM}\"Remind me to bring portfolio samples to the meeting with [lead name]\"${NC}"
echo -e "  -> Verify: AI calls setReminder tool, confirms with appointment details"
echo -e "  -> Check: Convex dashboard -> appointments table -> notes field should have [Reminder ...] marker"
echo ""
echo -e "  ${BOLD}Step 3: Check Reminders via Chat${NC}"
echo -e "  -> Say: ${DIM}\"What reminders do I have?\"${NC}"
echo -e "  -> Verify: AI calls listReminders tool, shows your appointments with reminder notes"
echo ""
echo -e "  ${BOLD}Step 4: Timezone Verification${NC}"
echo -e "  -> Set timezone to a far-off zone (e.g. ${DIM}\"Pacific/Auckland\"${NC})"
echo -e "  -> Set a reminder and check the [Reminder YYYY-MM-DD] marker"
echo -e "  -> The date should be the current date in that timezone, not UTC"
echo ""
echo -e "  ${BOLD}Step 5: Edge Cases${NC}"
echo -e "  -> Try: ${DIM}\"Remind me about my meeting with nonexistent-person\"${NC}"
echo -e "  -> Verify: AI reports no matching appointment, suggests creating one"
echo -e "  -> Cancel an appointment, then try: ${DIM}\"Remind me about that cancelled meeting\"${NC}"
echo -e "  -> Verify: AI reports appointment is not schedulable"
echo ""
echo -e "  ${BOLD}Step 6: Cron Agent + Chat Interop${NC}"
echo -e "  -> Set a reminder via chat on an appointment"
echo -e "  -> Wait for the daily reminder cron (or trigger manually)"
echo -e "  -> Verify: cron agent does NOT add a duplicate reminder (idempotency)"
echo -e "  -> The [Reminder] markers from chat and cron use the same format"
echo ""
echo -e "  ${BOLD}Step 7: Verify org timezone flows to cron agent${NC}"
echo -e "  -> Set organization timezone in Convex dashboard"
echo -e "  -> Manually trigger reminder agent: ${YELLOW}npx convex run --no-push agentRunner:runReminderAgent${NC}"
echo -e "  -> Check appointment notes: [Reminder] date should match org timezone"
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"

exit $fail

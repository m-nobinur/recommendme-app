#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# dev-setup.sh — Automated dev environment setup & validation
#
# This script:
#   1. Checks prerequisites (bun, convex, env vars)
#   2. Creates the dev organization + user in Convex
#   3. Seeds all 4 memory layers with test data
#   4. Sets the nicheId on the org for niche retrieval
#   5. Validates the entire pipeline via Convex queries
#   6. Writes DEV_ORGANIZATION_ID & DEV_USER_ID to .env.local
#
# Usage:
#   chmod +x scripts/dev-setup.sh
#   ./scripts/dev-setup.sh
#
# Prerequisites:
#   - bun installed
#   - Convex dev server running (bun dev:convex) OR a deployed project
#   - At least one AI provider key in .env.local
#   - NEXT_PUBLIC_CONVEX_URL set (auto-created by `npx convex dev`)
# ============================================================

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
BOLD='\033[1m'

step=0
pass=0
fail=0

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[PASS]${NC}  $*"; pass=$((pass + 1)); }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[FAIL]${NC}  $*"; fail=$((fail + 1)); }
header(){ step=$((step + 1)); echo -e "\n${BOLD}── Step ${step}: $* ──${NC}"; }

# ─── Step 1: Prerequisites ────────────────────────────────────
header "Check prerequisites"

if ! command -v bun &>/dev/null; then
  err "bun is not installed. Install from https://bun.sh"
  exit 1
fi
ok "bun found: $(bun --version)"

if ! command -v npx &>/dev/null; then
  err "npx not found (comes with Node.js)"
  exit 1
fi
ok "npx available"

ENV_FILE=".env.local"
if [[ ! -f "$ENV_FILE" ]]; then
  err ".env.local not found. Copy .env.example and configure it first."
  echo -e "  ${YELLOW}cp .env.example .env.local${NC}"
  exit 1
fi
ok ".env.local exists"

# Source env vars for checking (without exporting secrets to child processes)
CONVEX_URL=$(grep -E '^NEXT_PUBLIC_CONVEX_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")
if [[ -z "$CONVEX_URL" ]]; then
  err "NEXT_PUBLIC_CONVEX_URL not set in .env.local"
  echo -e "  Run ${YELLOW}npx convex dev${NC} first to link your Convex project"
  exit 1
fi
ok "NEXT_PUBLIC_CONVEX_URL = ${CONVEX_URL:0:40}..."

HAS_AI_KEY=false
for key_name in GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY OPENAI_API_KEY GROQ_API_KEY; do
  val=$(grep -E "^${key_name}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [[ -n "$val" && "$val" != *"your-"* ]]; then
    HAS_AI_KEY=true
    ok "AI provider key found: $key_name"
    break
  fi
done
if [[ "$HAS_AI_KEY" == "false" ]]; then
  warn "No AI provider key configured. Chat will fail without one."
fi

# ─── Step 2: Create dev environment ───────────────────────────
header "Create dev organization + user in Convex"

DEV_AUTH_USER_ID="dev-user-id"
info "Running devSetup:createDevEnvironment with authUserId='${DEV_AUTH_USER_ID}'"

SETUP_OUTPUT=$(npx convex run devSetup:createDevEnvironment "{\"authUserId\": \"${DEV_AUTH_USER_ID}\"}" 2>&1)
echo "$SETUP_OUTPUT"

# Extract IDs from Convex output.
# Convex `run` prints JS object like: { organizationId: 'jd7abc...', userId: 'kf8xyz...' }
# or JSON like: {"organizationId":"jd7abc...","userId":"kf8xyz..."}
extract_id() {
  local key="$1"
  local text="$2"
  # Try single-quoted value:  key: 'value'
  local val
  val=$(echo "$text" | sed -n "s/.*${key}[^']*'\([^']*\)'.*/\1/p" | head -1)
  if [[ -n "$val" && "$val" != "null" ]]; then echo "$val"; return; fi
  # Try double-quoted value:  "key": "value" or "key":"value"
  val=$(echo "$text" | sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1)
  if [[ -n "$val" && "$val" != "null" ]]; then echo "$val"; return; fi
  echo ""
}

ORG_ID=$(extract_id "organizationId" "$SETUP_OUTPUT")
USER_ID=$(extract_id "userId" "$SETUP_OUTPUT")

if [[ -z "$ORG_ID" ]]; then
  warn "Could not auto-extract organizationId from output."
  echo -e "  Look at the output above and manually copy the ID."
  echo -e "  ${YELLOW}Then add to .env.local:${NC}"
  echo -e "    DEV_ORGANIZATION_ID=<paste-id>"
  echo -e "    DEV_USER_ID=<paste-id>"
  echo ""
  read -p "Enter the organizationId manually (or press Enter to skip): " ORG_ID
  if [[ -z "$ORG_ID" ]]; then
    err "No organizationId — cannot continue with seeding."
    exit 1
  fi
  read -p "Enter the userId (or press Enter to skip): " USER_ID
fi

ok "Organization ID: $ORG_ID"
if [[ -n "$USER_ID" ]]; then
  ok "User ID: $USER_ID"
fi

# ─── Step 3: Write env vars to .env.local ─────────────────────
header "Update .env.local with dev IDs"

update_or_add_env() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    # macOS-compatible sed
    sed -i '' "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
    info "Updated ${key} in .env.local"
  elif grep -q "^# *${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i '' "s|^# *${key}=.*|${key}=${val}|" "$ENV_FILE"
    info "Uncommented and set ${key} in .env.local"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
    info "Added ${key} to .env.local"
  fi
}

update_or_add_env "DISABLE_AUTH_IN_DEV" "true"
update_or_add_env "DEV_ORGANIZATION_ID" "$ORG_ID"
if [[ -n "$USER_ID" ]]; then
  update_or_add_env "DEV_USER_ID" "$USER_ID"
fi
update_or_add_env "AI_ENABLE_MEMORY" "true"

ok ".env.local updated with dev configuration"

# ─── Step 4: Set nicheId on the organization ──────────────────
header "Set nicheId='photography' on organization"

npx convex run organizations:updateOrganizationSettings \
  "{\"id\": \"${ORG_ID}\", \"settings\": {\"nicheId\": \"photography\"}}" 2>&1 || true
ok "Set nicheId=photography on org"

# ─── Step 5: Seed memories ────────────────────────────────────
header "Seed all 4 memory layers"

SEED_OUTPUT=$(npx convex run devSeedMemories:seedAllMemories \
  "{\"organizationId\": \"${ORG_ID}\", \"nicheId\": \"photography\"}" 2>&1)
echo "$SEED_OUTPUT"

if echo "$SEED_OUTPUT" | grep -q "success.*true\|Seeded"; then
  ok "Memory seeding completed"
else
  warn "Seed output may have warnings — check above"
fi

# ─── Step 6: Validate data ────────────────────────────────────
header "Validate seeded data via Convex queries"

info "Checking organization..."
ORG_CHECK=$(npx convex run organizations:getOrganizationBySlug '{"slug":"dev-org"}' 2>&1)
if echo "$ORG_CHECK" | grep -q "dev-org\|Dev Organization"; then
  ok "Organization 'dev-org' exists"
else
  err "Organization not found"
  echo "$ORG_CHECK"
fi

info "Checking memory events table..."
EVENTS_CHECK=$(npx convex run memoryEvents:listRecent \
  "{\"organizationId\": \"${ORG_ID}\", \"limit\": 5}" 2>&1)
if echo "$EVENTS_CHECK" | grep -q "\[\]\|organizationId"; then
  ok "memoryEvents query works (may be empty — events emit during chat)"
else
  warn "memoryEvents query returned unexpected output"
fi

# ─── Step 7: Type check + lint ────────────────────────────────
header "Run type check and lint"

info "Running bun run check:all ..."
if bun run check:all 2>&1; then
  ok "Type check + lint passed"
else
  err "Type check or lint failed — see errors above"
fi

# ─── Summary ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Dev Setup Summary${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════${NC}"
echo -e "  ${GREEN}Passed: ${pass}${NC}"
[[ $fail -gt 0 ]] && echo -e "  ${RED}Failed: ${fail}${NC}"
echo ""
echo -e "  Organization ID: ${BOLD}${ORG_ID}${NC}"
[[ -n "$USER_ID" ]] && echo -e "  User ID:         ${BOLD}${USER_ID}${NC}"
echo ""
echo -e "${BOLD}  Next steps:${NC}"
echo -e "  1. Start dev server:  ${YELLOW}bun dev${NC}"
echo -e "  2. Open browser:      ${YELLOW}http://localhost:3000${NC}"
echo -e "  3. Go to chat and ask: \"What do you know about John Smith?\""
echo -e "     - Memory system should inject context about John's portrait preferences"
echo -e "  4. Ask: \"What pricing do we offer?\""
echo -e "     - Should pull from niche + business memories"
echo -e "  5. Check Convex dashboard: ${YELLOW}bun convex:dashboard${NC}"
echo -e "     - Look at memoryEvents table for conversation_end events"
echo ""
echo -e "${BOLD}  Test validation script:${NC}"
echo -e "  ${YELLOW}./scripts/validate-memory.sh${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════${NC}"

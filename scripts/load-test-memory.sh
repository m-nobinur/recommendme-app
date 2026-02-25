#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:3000/api/chat}"
REQUESTS="${REQUESTS:-5}"
CONCURRENCY="${CONCURRENCY:-3}"
PROMPT="${PROMPT:-What do you remember about the preferred appointment time for Sarah Johnson?}"
AUTH_HEADER="${AUTH_HEADER:-}"
AUTH_COOKIE_JAR="${AUTH_COOKIE_JAR:-}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
TIMES_FILE="${TMP_DIR}/times.txt"
FAILS_FILE="${TMP_DIR}/fails.txt"

extract_failure_reason() {
  local body_file="$1"
  local status="$2"

  python3 - "$body_file" "$status" <<'PY'
import json
import sys
from pathlib import Path

body_path = Path(sys.argv[1])
status = sys.argv[2] if len(sys.argv) > 2 else ""

try:
    text = body_path.read_text(encoding="utf-8", errors="replace")
except Exception:
    print("unreadable response body")
    sys.exit(0)

text = text.strip()
if not text:
    print("empty response body")
    sys.exit(0)

def as_reason(obj):
    if not isinstance(obj, dict):
        return None

    if isinstance(obj.get("error"), str) and obj.get("error"):
        return obj["error"]

    if obj.get("type") in ("error", "response-error"):
        for key in ("errorText", "message", "error"):
            val = obj.get(key)
            if isinstance(val, str) and val:
                return val
        return "stream returned error chunk"

    if obj.get("finishReason") == "error":
        return "stream finished with error"

    return None

# 1) Try whole-body JSON (non-stream responses, API errors, etc.)
try:
    payload = json.loads(text)
    reason = as_reason(payload)
    if reason:
        print(reason.replace("\n", " ")[:300])
        sys.exit(0)
except Exception:
    pass

# 2) Try parsing SSE chunks from streamed responses
for raw_line in text.splitlines():
    line = raw_line.strip()
    if not line.startswith("data:"):
        continue
    data = line[5:].strip()
    if not data or data == "[DONE]":
        continue
    try:
        chunk = json.loads(data)
    except Exception:
        continue
    reason = as_reason(chunk)
    if reason:
        print(reason.replace("\n", " ")[:300])
        sys.exit(0)

# 3) Only for non-2xx, provide a generic short snippet
if not status.startswith("2"):
    snippet = " ".join(text.split())
    print(snippet[:300])
    sys.exit(0)

# 4) 2xx with no semantic error
print("")
PY
}

run_one() {
  local idx="$1"
  local body_file="${TMP_DIR}/body-${idx}.json"
  local curl_args=(-sS -o "$body_file" -w "%{http_code} %{time_total}")
  curl_args+=(-H "Content-Type: application/json" -H "Accept: text/event-stream")
  if [[ -n "$AUTH_HEADER" ]]; then
    curl_args+=(-H "$AUTH_HEADER")
  fi
  if [[ -n "$AUTH_COOKIE_JAR" ]]; then
    curl_args+=(-b "$AUTH_COOKIE_JAR" -c "$AUTH_COOKIE_JAR")
  fi

  local escaped_prompt
  escaped_prompt=$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$PROMPT")
  local payload
  payload=$(printf '{"messages":[{"id":"load-%s","role":"user","parts":[{"type":"text","text":%s}]}]}' "$idx" "$escaped_prompt")

  curl_args+=(-X POST "$API_URL" -d "$payload")
  local out
  out=$(curl "${curl_args[@]}" || true)
  local status
  local time_total
  status="$(echo "$out" | awk '{print $1}')"
  time_total="$(echo "$out" | awk '{print $2}')"
  local reason
  reason="$(extract_failure_reason "$body_file" "$status")"

  if [[ "$status" =~ ^2[0-9][0-9]$ && -z "$reason" ]]; then
    echo "$time_total" >> "$TIMES_FILE"
  else
    echo "request=${idx} status=${status} time=${time_total} reason=${reason:-unknown}" >> "$FAILS_FILE"
  fi
}

echo "Running load test: requests=${REQUESTS}, concurrency=${CONCURRENCY}, url=${API_URL}"

for i in $(seq 1 "$REQUESTS"); do
  run_one "$i" &
  while (( $(jobs -rp | wc -l | tr -d ' ') >= CONCURRENCY )); do
    sleep 0.1
  done
done
wait

SUCCESS_COUNT=0
if [[ -f "$TIMES_FILE" ]]; then
  SUCCESS_COUNT="$(wc -l < "$TIMES_FILE" | tr -d ' ')"
fi

FAIL_COUNT=0
if [[ -f "$FAILS_FILE" ]]; then
  FAIL_COUNT="$(wc -l < "$FAILS_FILE" | tr -d ' ')"
fi

echo
echo "Results:"
echo "  success=${SUCCESS_COUNT}"
echo "  failed=${FAIL_COUNT}"

if [[ "$SUCCESS_COUNT" -gt 0 ]]; then
  python3 - "$TIMES_FILE" <<'PY'
import sys
from statistics import mean

times = []
with open(sys.argv[1], "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        times.append(float(line) * 1000.0)

times.sort()

def pct(p):
    if not times:
        return 0.0
    idx = int(round((p / 100.0) * (len(times) - 1)))
    return times[idx]

print(f"  avg_ms={mean(times):.1f}")
print(f"  p50_ms={pct(50):.1f}")
print(f"  p95_ms={pct(95):.1f}")
print(f"  p99_ms={pct(99):.1f}")
PY
fi

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo
  echo "Failures:"
  cat "$FAILS_FILE"
  if [[ -z "$AUTH_HEADER" && -z "$AUTH_COOKIE_JAR" ]]; then
    AUTH_401_COUNT="$(grep -c 'status=401' "$FAILS_FILE" 2>/dev/null || true)"
    if [[ "${AUTH_401_COUNT:-0}" -gt 0 ]]; then
      echo
      echo "Auth hint: requests are unauthorized."
      echo "  - In local dev, set DISABLE_AUTH_IN_DEV=true in .env.local"
      echo "  - Or pass AUTH_HEADER='Cookie: ...' / AUTH_COOKIE_JAR=/path/to/cookies.txt"
    fi
  fi
  exit 1
fi

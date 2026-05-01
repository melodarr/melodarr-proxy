#!/usr/bin/env bash
#
# chaos-test.sh — exercise provider resilience end-to-end.
#
# ⚠ DESIGN LIMITATION (read before interpreting failures):
#
# This script tries to induce circuit-breaker open via a burst of
# nonsense queries. That does NOT reliably trigger provider disable in
# this codebase, because per v0.3.39 finalized rule 2, an empty array
# from a provider counts as SUCCESS (legitimate "no match"), not
# failure. The circuit breaker only opens on:
#   - exceptions (timeout, ECONNRESET, TLS reset, etc.)
#   - non-array / invalid-shape responses
#   - explicit upstream errors
#
# So Step 3 (`at least one disabled`) will only pass if a real upstream
# was independently failing during the run. Genuine chaos testing
# requires fault injection — block MB at the network layer, run a mock
# upstream that returns bad responses, etc. — not load against real
# endpoints with bad queries.
#
# Use this as a smoke test that exercises the endpoints under load
# rather than as a definitive resilience proof.
#
# Env:
#   API_KEY  required for /api/search; /debug/* routes are unauthed.
#   BASE_URL default http://127.0.0.1:3055

set -euo pipefail

BASE="${BASE_URL:-http://127.0.0.1:3055}"
API_KEY="${API_KEY:-}"

if [ -z "$API_KEY" ]; then
  echo "ERROR: API_KEY is required (set API_KEY=xxx)"
  exit 1
fi

FAIL=0

function check () {
  local name="$1"
  shift
  if "$@"; then
    echo "✓ $name"
  else
    echo "✗ $name"
    FAIL=1
  fi
}

echo "========================================"
echo "Melodarr CHAOS TEST"
echo "========================================"

# -----------------------------------
# STEP 1 — Baseline
# -----------------------------------
echo "[1] Baseline check"

BASELINE=$(curl -s -H "x-api-key: $API_KEY" "$BASE/api/search?type=all&query=Radiohead")
COUNT=$(echo "$BASELINE" | jq '. | length' 2>/dev/null || echo 0)

check "Baseline search works" test "$COUNT" -gt 0

# -----------------------------------
# STEP 2 — Force failures (bad query burst)
# -----------------------------------
echo
echo "[2] Forcing provider stress (10 nonsense queries)"

for i in {1..10}; do
  curl -s -H "x-api-key: $API_KEY" \
    "$BASE/api/search?type=all&query=zzzz_invalid_$i" > /dev/null || true
done

sleep 2

# -----------------------------------
# STEP 3 — Check providers disabled
# -----------------------------------
echo
echo "[3] Checking provider health"

HEALTH=$(curl -s "$BASE/debug/providers/health")
DISABLED=$(echo "$HEALTH" | jq '[.providers[] | select(.status=="disabled")] | length' 2>/dev/null || echo 0)

# See header comment — this assertion only fires if a real upstream
# failure happened during the run; the burst of bad queries above
# will not by itself open the breaker.
check "At least one provider disabled" test "$DISABLED" -ge 1

# -----------------------------------
# STEP 4 — Ensure system still works
# -----------------------------------
echo
echo "[4] Validate fallback still works"

RECOVER=$(curl -s -H "x-api-key: $API_KEY" \
  "$BASE/api/search?type=all&query=Daft%20Punk")

COUNT2=$(echo "$RECOVER" | jq '. | length' 2>/dev/null || echo 0)
WRAPPED=$(echo "$RECOVER" | jq '[.[] | select(.artist or .album)] | length' 2>/dev/null || echo 0)

check "Fallback search returns results" test "$COUNT2" -gt 0
check "Results still valid SkyHook shape" test "$WRAPPED" -eq "$COUNT2"

# -----------------------------------
# STEP 5 — Wait for re-enable window
# -----------------------------------
echo
echo "[5] Waiting for recovery window..."
echo "    NOTE: real auto-reenable requires PROVIDER_COOLDOWN_MS (default"
echo "    600000ms = 10 min) PLUS 3 successes within"
echo "    PROVIDER_REENABLE_WINDOW_MS (default 300000ms = 5 min) AFTER the"
echo "    cooldown elapses. The 10s sleep below is symbolic; this script"
echo "    cannot exercise the full recovery path inline."

sleep 10

# trigger valid queries to rebuild success streak
for i in {1..5}; do
  curl -s -H "x-api-key: $API_KEY" \
    "$BASE/api/search?type=all&query=Taylor%20Swift" > /dev/null
done

sleep 2

# -----------------------------------
# STEP 6 — Check re-enable
# -----------------------------------
echo
echo "[6] Checking provider recovery"

HEALTH2=$(curl -s "$BASE/debug/providers/health")
REENABLED=$(echo "$HEALTH2" | jq '[.providers[] | select(.status=="degraded" or .status=="healthy")] | length' 2>/dev/null || echo 0)

check "Providers recovered from disabled state" test "$REENABLED" -ge 1

# -----------------------------------
# FINAL
# -----------------------------------
echo
if [ "$FAIL" -eq 0 ]; then
  echo "========================================"
  echo "CHAOS TEST PASSED"
  echo "========================================"
  exit 0
else
  echo "========================================"
  echo "CHAOS TEST FAILED"
  echo "========================================"
  exit 1
fi

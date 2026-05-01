#!/usr/bin/env bash
#
# post-deploy-check.sh — fast post-deploy validation for the proxy.
#
# Run on LXC 163 (or any host with loopback to the proxy) immediately
# after a deploy. Exit code: 0 = healthy, 1 = broken.
#
# Env knobs:
#   BASE_URL  default http://127.0.0.1:3055
#   API_KEY   required for /api/search and /api/v1/artist/discover when
#             REQUIRE_API_KEY is not 'false'. If unset, those checks
#             will likely fail with 401.

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3055}"
API_KEY="${API_KEY:-}"

if [ -z "${API_KEY:-}" ]; then
  echo "ERROR: API_KEY is required for validation (set API_KEY=xxx)"
  exit 1
fi

FAIL=0

echo "========================================"
echo "Melodarr Post-Deploy Validation"
echo "========================================"

# Build curl auth args once. Empty array if no key — handles the
# REQUIRE_API_KEY=false deployment case gracefully.
AUTH_ARGS=()
if [ -n "$API_KEY" ]; then
  AUTH_ARGS=(-H "x-api-key: $API_KEY")
fi

# `check` runs $@ and prints PASS/FAIL based on its exit code. With
# `set -e` the failing command inside an `if` does NOT exit the script
# (set -e is suppressed for if-condition commands), so FAIL=1 records
# correctly without aborting.
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

echo
echo "[1] API Health"

# /api/health is public (no auth middleware). -o /dev/null silences
# curl's body output without silencing check's echo.
check "API reachable" curl -sf -o /dev/null "$BASE_URL/api/health"

echo
echo "[2] Search Validation"

QUERY=$(node -e "console.log(require('./src/utils/testArtists').getNextArtist())" 2>/dev/null || echo "Radiohead")
ENCODED=$(echo "$QUERY" | sed 's/ /%20/g')

echo "Testing artist: $QUERY"

# Capture body and HTTP status separately so the script can report a
# clean failure if /api/search returns 401 / 502 / etc. instead of
# letting `set -e` kill us with no diagnostic.
TMP_BODY=$(mktemp -t melodarr-pdc.XXXXXX)
trap 'rm -f "$TMP_BODY"' EXIT

HTTP_CODE=$(curl -s -o "$TMP_BODY" -w '%{http_code}' \
  "${AUTH_ARGS[@]}" \
  "$BASE_URL/api/search?type=all&query=$ENCODED")

if [ "$HTTP_CODE" != "200" ]; then
  echo "✗ /api/search HTTP $HTTP_CODE"
  echo "  body: $(head -c 200 "$TMP_BODY")"
  FAIL=1
  COUNT=0
  WRAPPED=0
else
  COUNT=$(jq '. | length' < "$TMP_BODY" 2>/dev/null || echo 0)
  WRAPPED=$(jq '[.[] | select(.artist or .album)] | length' < "$TMP_BODY" 2>/dev/null || echo 0)
fi

check "Results returned" test "$COUNT" -gt 0
check "All items wrapped (SkyHook)" test "$WRAPPED" -eq "$COUNT"
check "Aggregation sanity (>=3)" test "$COUNT" -ge 3

echo
echo "[3] Discovery Fallback"

DISC_CODE=$(curl -s -o "$TMP_BODY" -w '%{http_code}' \
  "${AUTH_ARGS[@]}" \
  "$BASE_URL/api/v1/artist/discover?q=$ENCODED")

if [ "$DISC_CODE" != "200" ]; then
  echo "✗ /api/v1/artist/discover HTTP $DISC_CODE"
  echo "  body: $(head -c 200 "$TMP_BODY")"
  FAIL=1
  DCOUNT=0
else
  # /api/v1/artist/discover returns an envelope { candidates: [...], ... }
  # rather than a flat array, per the controller contract — so we count
  # .candidates not the top-level length.
  DCOUNT=$(jq '.candidates // [] | length' < "$TMP_BODY" 2>/dev/null || echo 0)
fi

check "Discovery returns results" test "$DCOUNT" -gt 0

echo
if [ "$FAIL" -eq 0 ]; then
  echo "========================================"
  echo "ALL CHECKS PASSED"
  echo "========================================"
  exit 0
else
  echo "========================================"
  echo "VALIDATION FAILED"
  echo "========================================"
  exit 1
fi

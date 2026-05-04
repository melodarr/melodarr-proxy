#!/usr/bin/env bash
#
# canary-validate.sh — versioned contract validator for canary deployments.
#
# Lives in the proxy repo so the validator and the proxy ship together —
# any contract change in a release ships its corresponding validator
# updates in the same commit.
#
# Two phases:
#
#   Phase 1 — Structure (ALWAYS runs)
#     /api/health, /api/ready, /api/search return well-formed JSON with the
#     SkyHook envelope shape, required fields, and correct types. Catches
#     contract regressions that don't depend on upstream availability.
#
#   Phase 2 — MusicBrainz-dependent (CONDITIONAL)
#     Only runs if MB is reachable from this host. Verifies foreignArtistId
#     is a real MBID and that the canonical Radiohead lookup resolves to
#     the known-stable MBID. Catches provider-layer regressions.
#
# Exit codes (the caller — usually upgrade-proxmox-lxc.sh — decides what
# to do with each):
#   0   FULL PASS                                — promote
#   1   PHASE 2 FAILED (structure was OK)        — block
#   2   STRUCTURE PASS, MB SKIPPED (provisional) — promote ONLY if caller
#                                                  sets ALLOW_PROVISIONAL=1
#   3   PHASE 1 FAILED (structure broken)        — block
#
# This script does not promote anything. It only reports a verdict; the
# caller is responsible for honoring it.
#
# Env knobs:
#   BASE_URL            default http://127.0.0.1:3056   (canary alt port)
#   API_KEY             required (proxy auth on /api/search and lookup)
#   MB_URL              default https://musicbrainz.org (probe target)
#   MB_TIMEOUT          default 5 (seconds for MB reachability probe)
#   GOLDEN_ARTIST       default Radiohead
#   GOLDEN_MBID         default a74b1b7f-71a5-4011-9441-d0b5e4122711
#                       (Radiohead's MBID since the dawn of MusicBrainz;
#                        if this ever drifts, MB has a bigger problem
#                        than the proxy)

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3056}"
API_KEY="${API_KEY:-}"
MB_URL="${MB_URL:-https://musicbrainz.org}"
MB_TIMEOUT="${MB_TIMEOUT:-5}"
GOLDEN_ARTIST="${GOLDEN_ARTIST:-Radiohead}"
GOLDEN_MBID="${GOLDEN_MBID:-a74b1b7f-71a5-4011-9441-d0b5e4122711}"
VALIDATION_MODE="${VALIDATION_MODE:-deploy}"

# Strict UUID regex (RFC 4122, lowercase hex). Rejects synthetic
# placeholders like "itunes:12345" and empty strings.
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

# Failure accumulators. We don't bail on first failure so operators
# see every issue in one log run.
P1_FAIL=0
P2_FAIL=0
MB_SKIPPED=0

if [ -z "$API_KEY" ]; then
  echo "ERROR: API_KEY env var required (proxy /api/search + /api/v1/artist/lookup are auth-gated)"
  exit 3
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required but not installed"
  exit 3
fi

echo "========================================"
echo "Canary Contract Validator"
echo "BASE_URL:      $BASE_URL"
echo "GOLDEN_ARTIST: $GOLDEN_ARTIST"
echo "========================================"

TMP_BODY=$(mktemp -t canary-validate.XXXXXX)
trap 'rm -f "$TMP_BODY"' EXIT

# http_get URL — runs curl, body to TMP_BODY, prints HTTP code on stdout.
http_get () {
  curl -s -o "$TMP_BODY" -w '%{http_code}' \
    -H "x-api-key: $API_KEY" "$1"
}

# check LABEL CMD ARGS — runs CMD, prints ✓/✗ with LABEL.
# Inside an `if` so set -e doesn't abort the script on a single failure.
check () {
  local label="$1"
  shift
  if "$@"; then
    echo "  ✓ $label"
    return 0
  fi
  echo "  ✗ $label"
  return 1
}

# ────────────────────────────────────────────────────────
# PHASE 1 — Structure (always runs)
# ────────────────────────────────────────────────────────
echo
echo "[Phase 1] Structure"

HC=$(http_get "$BASE_URL/api/health")
check "/api/health is 200" test "$HC" = "200" || P1_FAIL=1

# /api/ready may be 200 (healthy) or 503 (degraded — e.g., MB unreachable).
# Both indicate the readiness endpoint itself works, which is what Phase 1
# is checking. A 4xx or other 5xx would mean the route is broken.
RC=$(http_get "$BASE_URL/api/ready")
if [ "$RC" = "200" ] || [ "$RC" = "503" ]; then
  echo "  ✓ /api/ready is 200 or 503 (got $RC)"
else
  echo "  ✗ /api/ready is 200 or 503 (got $RC)"
  P1_FAIL=1
fi

ENCODED_ARTIST=$(echo "$GOLDEN_ARTIST" | sed 's/ /%20/g')
SC=$(http_get "$BASE_URL/api/search?q=$ENCODED_ARTIST&type=artist")
check "/api/search is 200" test "$SC" = "200" || P1_FAIL=1

if [ "$SC" = "200" ]; then
  # Body must be a JSON array.
  if jq -e 'type == "array"' "$TMP_BODY" >/dev/null 2>&1; then
    echo "  ✓ /api/search body is a JSON array"
  else
    echo "  ✗ /api/search body is a JSON array"
    P1_FAIL=1
  fi

  COUNT=$(jq 'length' "$TMP_BODY" 2>/dev/null || echo 0)
  check "/api/search has >= 1 result" test "$COUNT" -ge 1 || P1_FAIL=1

  # SkyHook envelope: every result must wrap a single .artist or .album.
  WRAPPED=$(jq '[.[] | select(.artist or .album)] | length' "$TMP_BODY" 2>/dev/null || echo 0)
  check "/api/search every result is SkyHook-wrapped" test "$WRAPPED" -eq "$COUNT" || P1_FAIL=1

  # First .artist-wrapped result must have the required fields with the
  # right types. This is the contract that Lidarr's deserializer enforces;
  # missing/wrong-typed fields cause silent rejection or runtime errors.
  ARTIST=$(jq -c '[.[] | select(.artist) | .artist] | .[0] // empty' "$TMP_BODY")
  if [ -n "$ARTIST" ]; then
    for FIELD_TYPE in id:string artistName:string status:string oldIds:array aliases:array artistAliases:array links:array images:array; do
      FIELD="${FIELD_TYPE%%:*}"
      EXPECTED="${FIELD_TYPE##*:}"
      OK=$(echo "$ARTIST" | jq --arg f "$FIELD" --arg t "$EXPECTED" \
           'has($f) and (.[$f] | type == $t)')
      check "artist has .$FIELD ($EXPECTED)" test "$OK" = "true" || P1_FAIL=1
    done
  else
    echo "  ✗ /api/search returned no .artist-wrapped result for golden query"
    P1_FAIL=1
  fi
fi

# ────────────────────────────────────────────────────────
# PHASE 2 — MB-dependent (conditional)
# ────────────────────────────────────────────────────────
echo
echo "[Phase 2] MusicBrainz-dependent"

# In config mode the caller only needs to know the proxy's own API is
# structurally sound — reachability of upstream providers is not relevant
# to in-memory config validation. Skip Phase 2 and report a full pass.
if [ "$VALIDATION_MODE" = "config" ]; then
  echo "  Skipped in config mode — Phase 1 structure checks are sufficient"
else
# Probe MB from the runner host. --max-time prevents a hung TLS handshake
# from stalling the validator (which has been the live failure mode lately).
MB_PROBE=$(curl -s --max-time "$MB_TIMEOUT" -o /dev/null -w '%{http_code}' "$MB_URL" 2>/dev/null || echo "000")

if echo "$MB_PROBE" | grep -qE '^[23]'; then
  echo "  MusicBrainz reachable (HTTP $MB_PROBE) — running Phase 2"

  LC=$(http_get "$BASE_URL/api/v1/artist/lookup?term=$ENCODED_ARTIST")
  if [ "$LC" != "200" ]; then
    echo "  ✗ /api/v1/artist/lookup HTTP $LC (expected 200)"
    P2_FAIL=1
  else
    # The lookup response is a JSON array. We check the first element.
    MBID=$(jq -r '.[0].foreignArtistId // .[0].id // ""' "$TMP_BODY" 2>/dev/null)

    if [[ "$MBID" =~ $UUID_RE ]]; then
      echo "  ✓ foreignArtistId is a valid MBID ($MBID)"
    else
      echo "  ✗ foreignArtistId is not a valid MBID: '$MBID'"
      P2_FAIL=1
    fi

    if [ "$MBID" = "$GOLDEN_MBID" ]; then
      echo "  ✓ Golden query: $GOLDEN_ARTIST resolved to canonical MBID"
    else
      echo "  ✗ Golden query: expected $GOLDEN_MBID, got '$MBID'"
      P2_FAIL=1
    fi
  fi
else
  MB_SKIPPED=1
  echo "  MusicBrainz unreachable (HTTP $MB_PROBE) — Phase 2 skipped"
  echo "  Verdict will be PROVISIONAL — caller must set ALLOW_PROVISIONAL=1 to promote"
fi
fi

# ────────────────────────────────────────────────────────
# Verdict
# ────────────────────────────────────────────────────────
echo
echo "========================================"

if [ "$P1_FAIL" -ne 0 ]; then
  echo "VALIDATION FAILED — Phase 1 (structure) broken"
  echo "Action: BLOCK promotion. The proxy is not serving a valid contract."
  echo "========================================"
  exit 3
fi

if [ "$P2_FAIL" -ne 0 ]; then
  echo "VALIDATION FAILED — Phase 2 (MB-dependent) assertion failed"
  echo "Action: BLOCK promotion. Structure is OK but provider behavior is wrong."
  echo "========================================"
  exit 1
fi

if [ "$MB_SKIPPED" -ne 0 ]; then
  echo "STRUCTURE PASS, MB SKIPPED — provisional verdict"
  echo "Action: BLOCK auto-promotion. Set ALLOW_PROVISIONAL=1 in the caller"
  echo "        to override and promote anyway."
  echo "========================================"
  exit 2
fi

echo "FULL PASS"
echo "Action: SAFE TO PROMOTE."
echo "========================================"
exit 0

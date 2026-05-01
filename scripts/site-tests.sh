#!/usr/bin/env bash
# Verification harness for the deployed melodarr-proxy.
# Runs against an LXC at $CTID over the in-LXC loopback proxy URL.
#
# Env knobs:
#   CTID         — Proxmox container ID         (default: 163)
#   BASE_URL     — proxy URL inside the LXC     (default: http://127.0.0.1:3055)
#   API_KEY      — proxy API key                (default: empty → unauthenticated requests)
#   SKIP_DEPLOY  — set to 1 to skip pull+up     (default: 0)
#   REENABLE_MB  — set to 1 to clear saved metadataProviders/providerPriority
#                  overrides and restart the proxy (re-enables MusicBrainz)
#                  (default: 0 — verify-only, never mutate)
#   EXPECTED_REV — git SHA expected from /api/version (default: v0.3.36 commit)
#
# Tracks pass/fail per check and exits non-zero if any test failed.

set -uo pipefail

CTID="${CTID:-163}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3055}"
API_KEY="${API_KEY:-}"
SKIP_DEPLOY="${SKIP_DEPLOY:-0}"
REENABLE_MB="${REENABLE_MB:-0}"
EXPECTED_REV="${EXPECTED_REV:-f63d5fd82dc40f85a2a6172b4b566d006660cbb7}"

# ── Optional interactive wizard ──────────────────────────────────
# Prompts for each knob when stdin is a TTY.  Users can:
#   - press Enter to accept the default shown in [brackets]
#   - pre-set any var via env to skip that prompt's default
#   - pass INTERACTIVE=0 to bypass the wizard entirely (CI use)
ask () {
  local var="$1" prompt="$2" default="$3" reply
  read -rp "$prompt [$default]: " reply
  printf -v "$var" '%s' "${reply:-$default}"
}
ask_yn () {
  local var="$1" prompt="$2" default="$3" reply hint="(y/N)"
  [ "$default" = "1" ] && hint="(Y/n)"
  read -rp "$prompt $hint: " reply
  case "${reply:-$default}" in
    1|y|Y|yes|YES) printf -v "$var" '%s' "1" ;;
    *)             printf -v "$var" '%s' "0" ;;
  esac
}

if [ -t 0 ] && [ "${INTERACTIVE:-1}" = "1" ]; then
  echo "Melodarr verification harness — interactive setup"
  echo "Press Enter for the default; set INTERACTIVE=0 to skip the wizard."
  echo
  ask    CTID         "Proxmox CTID"                          "$CTID"
  ask    BASE_URL     "Proxy URL inside the LXC"              "$BASE_URL"
  ask    API_KEY      "Proxy API key (blank = unauthed)"      "$API_KEY"
  ask_yn SKIP_DEPLOY  "Skip pull + recreate of proxy?"        "$SKIP_DEPLOY"
  ask_yn REENABLE_MB  "Re-enable MusicBrainz on this run?"    "$REENABLE_MB"
  ask    EXPECTED_REV "Expected git revision SHA"             "$EXPECTED_REV"
  echo
fi

# ── Pass/fail tracking ───────────────────────────────────────────
PASSES=0
FAILS=0
declare -a PASS_LOG=()
declare -a FAIL_LOG=()

record_pass () {
  PASSES=$((PASSES + 1))
  PASS_LOG+=("$*")
  echo "  PASS: $*"
}
record_fail () {
  FAILS=$((FAILS + 1))
  FAIL_LOG+=("$*")
  echo "  FAIL: $*"
}

# Strip trailing CR/whitespace — curl's `head -1` keeps the `\r` from HTTP
# headers, which clobbers later `(...)` formatting on the same line.
chomp () {
  printf '%s' "$1" | tr -d '\r' | sed -e 's/[[:space:]]*$//'
}

# ── Remote curl helpers ──────────────────────────────────────────
# API_KEY is passed via env to the inner shell — never interpolated into
# a quoted string — so quotes/$ in the key won't break the command.
remote_get () {
  # Body only.  Usage: remote_get <path>
  pct exec "$CTID" -- env API_KEY="$API_KEY" BASE_URL="$BASE_URL" PATH_ARG="$1" bash -lc '
    if [ -n "$API_KEY" ]; then
      curl -s "$BASE_URL$PATH_ARG" -H "X-Api-Key: $API_KEY"
    else
      curl -s "$BASE_URL$PATH_ARG"
    fi
  '
}

remote_get_full () {
  # Headers + body.  Usage: remote_get_full <path>
  pct exec "$CTID" -- env API_KEY="$API_KEY" BASE_URL="$BASE_URL" PATH_ARG="$1" bash -lc '
    if [ -n "$API_KEY" ]; then
      curl -i -s "$BASE_URL$PATH_ARG" -H "X-Api-Key: $API_KEY"
    else
      curl -i -s "$BASE_URL$PATH_ARG"
    fi
  '
}

remote_status_line () {
  remote_get_full "$1" | head -1
}

remote_post () {
  pct exec "$CTID" -- env API_KEY="$API_KEY" BASE_URL="$BASE_URL" PATH_ARG="$1" bash -lc '
    if [ -n "$API_KEY" ]; then
      curl -s -X POST "$BASE_URL$PATH_ARG" -H "X-Api-Key: $API_KEY"
    else
      curl -s -X POST "$BASE_URL$PATH_ARG"
    fi
  '
}

echo "Melodarr verification harness"
echo "CTID=$CTID  BASE_URL=$BASE_URL  SKIP_DEPLOY=$SKIP_DEPLOY"

# ── 1. Disk + deploy ─────────────────────────────────────────────
echo
echo "## Disk check"
pct exec "$CTID" -- bash -lc 'df -h /var/lib/docker 2>/dev/null; docker system df'

if [ "$SKIP_DEPLOY" = "0" ]; then
  echo
  echo "## Deploy proxy only"
  if pct exec "$CTID" -- bash -lc 'cd /opt/melodarr-proxy && docker compose pull proxy && docker compose up -d --force-recreate proxy'; then
    record_pass "deploy succeeded"
    sleep 5
  else
    record_fail "deploy failed — aborting verification"
    echo
    echo "Re-run with SKIP_DEPLOY=1 to verify against the existing deployment."
    exit 1
  fi
else
  echo
  echo "## Deploy skipped (SKIP_DEPLOY=$SKIP_DEPLOY)"
fi

# ── 2. Version check ─────────────────────────────────────────────
echo
echo "## Version check"
VERSION_BODY=$(remote_get /api/version)
echo "$VERSION_BODY" | jq
ACTUAL_REV=$(echo "$VERSION_BODY" | jq -r '.revision // empty')
if [ "$ACTUAL_REV" = "$EXPECTED_REV" ]; then
  record_pass "running expected revision $ACTUAL_REV"
else
  record_fail "expected revision=$EXPECTED_REV, got=$ACTUAL_REV — deploy did not land or you're on a different version"
fi

# ── 2.5. Optional: re-enable MusicBrainz (REENABLE_MB=1) ─────────
# Lidarr's data model is keyed on MB UUIDs.  When MB has been excluded
# from metadataProviders (e.g. during a TLS outage), Lidarr searches
# return empty foreignArtistIds and Lidarr rejects the response.
# Setting REENABLE_MB=1 clears the saved runtime overrides under
# .runtime in /data/settings.json (bind-mounted into the proxy
# container at the same path) and restarts the proxy.
#
# We verify BEHAVIOR not just config — the action is only considered
# successful when MB is in active providers AND the settings file no
# longer shadows them AND a real lookup populates foreignArtistId AND
# /debug/upstream shows MB activity.
if [ "$REENABLE_MB" = "1" ]; then
  echo
  echo "## Re-enable MusicBrainz (REENABLE_MB=1)"
  REENABLE_TS=$(date +%s)

  # Action: backup, clear runtime overrides, restart proxy.
  if pct exec "$CTID" -- bash -lc "
set -e
[ -f /data/settings.json ] || { echo 'ERROR: /data/settings.json not found on LXC' >&2; exit 1; }
cp /data/settings.json /data/settings.json.bak.${REENABLE_TS}
jq 'del(.runtime.metadataProviders, .runtime.providerPriority)' /data/settings.json > /tmp/settings.new
mv /tmp/settings.new /data/settings.json
cd /opt/melodarr-proxy && docker compose restart proxy > /dev/null
"; then
    echo "  Backup: /data/settings.json.bak.${REENABLE_TS}"
    echo "  Proxy restarting; waiting 10s for it to come back up..."
    sleep 10
    remote_post /api/cache/clear > /dev/null 2>&1 || true
    echo "  Cache cleared, running PASS gates..."
  else
    record_fail "MB re-enable: settings.json edit or proxy restart failed (see ERROR above)"
  fi

  # ── PASS gate 1: /api/ready shows musicbrainz in active providers ──
  READY_AFTER=$(remote_get /api/ready)
  ACTIVE_AFTER=$(echo "$READY_AFTER" | jq -r '.upstreamDetail.activeProviders // [] | join(",")')
  echo "  Active providers now: $ACTIVE_AFTER"
  if echo ",$ACTIVE_AFTER," | grep -q ',musicbrainz,'; then
    record_pass "MB re-enable: /api/ready shows musicbrainz in active providers"
  else
    record_fail "MB re-enable: /api/ready does NOT show musicbrainz (got: $ACTIVE_AFTER)"
  fi

  # ── PASS gates 2 & 3: settings.json no longer shadows providers ──
  # Read via `docker exec ... cat` so we see what the container sees.
  SETTINGS_RUNTIME=$(pct exec "$CTID" -- docker exec melodarr-proxy-proxy-1 cat /data/settings.json 2>/dev/null \
    | jq '.runtime // {} | {metadataProviders: (.metadataProviders // null), providerPriority: (.providerPriority // null)}')
  if echo "$SETTINGS_RUNTIME" | jq -e '.metadataProviders == null' > /dev/null 2>&1; then
    record_pass "MB re-enable: settings.json runtime.metadataProviders override cleared"
  else
    OFFENDER=$(echo "$SETTINGS_RUNTIME" | jq -r '.metadataProviders')
    record_fail "MB re-enable: settings.json runtime.metadataProviders still set to '$OFFENDER'"
  fi
  if echo "$SETTINGS_RUNTIME" | jq -e '.providerPriority == null' > /dev/null 2>&1; then
    record_pass "MB re-enable: settings.json runtime.providerPriority override cleared"
  else
    OFFENDER=$(echo "$SETTINGS_RUNTIME" | jq -r '.providerPriority')
    record_fail "MB re-enable: settings.json runtime.providerPriority still set to '$OFFENDER'"
  fi

  # ── PASS gate 4: lookup returns a non-empty foreignArtistId (MBID) ──
  # This both verifies the merge sees MB AND populates /debug/upstream
  # for the next gate.
  LOOKUP_AFTER=$(remote_get '/api/v0.4/artist/lookup?term=radiohead')
  MBID_AFTER=$(echo "$LOOKUP_AFTER" | jq -r '.[0].foreignArtistId // ""')
  if [ -n "$MBID_AFTER" ] && [ "$MBID_AFTER" != "null" ]; then
    record_pass "MB re-enable: foreignArtistId populated ($MBID_AFTER)"
  else
    record_fail "MB re-enable: foreignArtistId still empty after re-enable"
  fi

  # ── PASS gate 5: /debug/upstream shows MB activity from the lookup ──
  UPSTREAM_AFTER=$(remote_get '/debug/upstream?provider=musicbrainz&limit=20')
  UPSTREAM_COUNT=$(echo "$UPSTREAM_AFTER" | jq -r '.filteredCount // 0' 2>/dev/null)
  [ -z "$UPSTREAM_COUNT" ] && UPSTREAM_COUNT=0
  if [ "$UPSTREAM_COUNT" -gt 0 ] 2>/dev/null; then
    record_pass "MB re-enable: /debug/upstream shows musicbrainz activity (filteredCount=$UPSTREAM_COUNT)"
  else
    record_fail "MB re-enable: /debug/upstream shows no musicbrainz activity (filteredCount=$UPSTREAM_COUNT)"
  fi
fi

# ── 3. Cache clear (forces fresh aggregations for Lidarr-shape tests) ──
echo
echo "## Clearing cache (fresh Lidarr-shape tests)"
remote_post /api/cache/clear > /dev/null 2>&1 || true
echo "  (cache cleared)"

# ── 4. /api/search 502 regression ────────────────────────────────
echo
echo "## Search endpoint should not 502"
SEARCH_STATUS=$(chomp "$(remote_status_line '/api/search?type=all&query=junkyards')")
echo "$SEARCH_STATUS"
if echo "$SEARCH_STATUS" | grep -q ' 200'; then
  record_pass "/api/search returns 200"
else
  record_fail "/api/search status: $SEARCH_STATUS"
fi

echo
echo "## Search response summary"
remote_get '/api/search?type=all&query=junkyards' \
  | jq 'if type == "object" then {has_albums: (.albums // [] | length > 0), partial, warning} else {count: length} end'

# ── 5. /api/v1/artist/discover 502 regression ────────────────────
echo
echo "## Artist discover should not 502"
DISC_STATUS=$(chomp "$(remote_status_line '/api/v1/artist/discover?q=junkyards')")
echo "$DISC_STATUS"
if echo "$DISC_STATUS" | grep -q ' 200'; then
  record_pass "/api/v1/artist/discover returns 200"
else
  record_fail "/api/v1/artist/discover status: $DISC_STATUS"
fi

echo
echo "## Artist discover response summary"
remote_get '/api/v1/artist/discover?q=junkyards' \
  | jq '{providers, partial, warning, candidate_count: (.candidates // [] | length)}'

# ── 6. Negative path ─────────────────────────────────────────────
echo
echo "## Negative search (garbage query → 200, never 5xx)"
NEG_STATUS=$(chomp "$(remote_status_line '/api/search?query=zzzzzzz_no_such_artist_xyz_98765')")
echo "$NEG_STATUS"
if echo "$NEG_STATUS" | grep -qE '^HTTP/[0-9.]+ (200|404)'; then
  record_pass "garbage query handled gracefully ($NEG_STATUS)"
else
  record_fail "garbage query returned non-2xx/404: $NEG_STATUS"
fi

# ── 7. PII / config-leak check ───────────────────────────────────
echo
echo "## PII/config leak check"
LEAK_FOUND=0
for path in "/api/search?type=all&query=junkyards" "/api/v1/artist/discover?q=junkyards"; do
  echo "=== $path ==="
  body=$(remote_get "$path")
  path_leak=0
  for needle in "jcwalker3" "yahoo.com" "musicbrainz.org" "Lunar Bridge" "User-Agent" '"fmt"' '"limit"'; do
    if echo "$body" | grep -qi "$needle"; then
      echo "  LEAK: response contains: $needle"
      path_leak=1
      LEAK_FOUND=1
    fi
  done
  [ "$path_leak" = 0 ] && echo "  CLEAN: no PII or upstream-config strings found"
done
if [ "$LEAK_FOUND" = 0 ]; then
  record_pass "no PII or upstream config in error bodies"
else
  record_fail "PII/config leak detected — see LEAK lines above"
fi

# ── 8. Ready / provider status ───────────────────────────────────
echo
echo "## Ready/provider status"
READY_BODY=$(remote_get /api/ready)
echo "$READY_BODY" | jq '{upstream, probedProvider: .upstreamDetail.probedProvider, activeProviders: .upstreamDetail.activeProviders}'
ACTIVE_PROVIDERS=$(echo "$READY_BODY" | jq -r '.upstreamDetail.activeProviders // [] | join(",")')
MB_ACTIVE=$(echo "$READY_BODY" | jq -r '.upstreamDetail.activeProviders // [] | index("musicbrainz") // empty')

# ── 9. Upstream buffer (gated on MB being active) ────────────────
echo
echo "## Upstream buffer provider counts"
if [ -n "$MB_ACTIVE" ]; then
  remote_get '/debug/upstream?limit=20' \
    | jq '[.entries[].provider] | group_by(.) | map({provider: .[0], count: length})'
else
  echo "  (skipped — musicbrainz not in activeProviders=[$ACTIVE_PROVIDERS]; buffer only records MB attempts)"
fi

# ── 10. Lidarr-compatible artist lookup endpoints ────────────────
echo
echo "## Lidarr-compatible artist lookup endpoints"

echo
echo "### /api/v1/artist/lookup raw response (first 100 lines)"
remote_get_full '/api/v1/artist/lookup?term=Radiohead' | head -100

echo
echo "### /api/v0.4/artist/lookup raw response (first 100 lines)"
remote_get_full '/api/v0.4/artist/lookup?term=Radiohead' | head -100

# Path-key auth form — Lidarr's C# URI builder strips query params, so it
# uses /api/<key>/v1/artist/lookup instead of header auth.  Test it
# explicitly so we catch path-key middleware regressions.
echo
echo "### Path-key auth form: /api/<key>/v1/artist/lookup"
if [ -n "$API_KEY" ]; then
  PATH_KEY_STATUS=$(chomp "$(pct exec "$CTID" -- env API_KEY="$API_KEY" BASE_URL="$BASE_URL" bash -lc '
    curl -i -s "$BASE_URL/api/$API_KEY/v1/artist/lookup?term=Radiohead" | head -1
  ')")
  echo "$PATH_KEY_STATUS"
  if echo "$PATH_KEY_STATUS" | grep -q ' 200'; then
    record_pass "path-key auth form returns 200"
  else
    record_fail "/api/<key>/v1/artist/lookup status: $PATH_KEY_STATUS"
  fi
else
  echo "  (skipped — API_KEY not set)"
fi

# ── 11. Lidarr/Skyhook shape conformance ─────────────────────────
echo
echo "### Validate /api/v1/artist/lookup Skyhook shape"
LOOKUP_BODY=$(remote_get '/api/v1/artist/lookup?term=Radiohead')

LOOKUP_SUMMARY=$(echo "$LOOKUP_BODY" | jq '
  if type == "array" then
    {
      ok: true,
      count: length,
      firstArtistName: (.[0].artistName // null),
      foreignArtistId: (.[0].foreignArtistId // null),
      foreignArtistIdEmpty: ((.[0].foreignArtistId // "") == ""),
      hasAlbums: (.[0] | has("albums")),
      albumCount: (.[0].albums // [] | length),
      providers: (.[0].providers // []),
      hasImages: (.[0] | has("images")),
      hasGenres: (.[0] | has("genres")),
      hasOverview: (.[0] | has("overview")),
      hasDisambiguation: (.[0] | has("disambiguation")),
      hasLinks: (.[0] | has("links")),
      hasPopularity: (.[0] | has("popularity")),
      hasStatus: (.[0] | has("status")),
      hasTags: (.[0] | has("tags")),
      firstAlbumDate: (.[0].albums[0].firstReleaseDate // null),
      firstAlbumDateIsoLike: ((.[0].albums[0].firstReleaseDate // "") | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}"))
    }
  else
    { ok: false, type: type, body: . }
  end
')
echo "$LOOKUP_SUMMARY" | jq

if echo "$LOOKUP_SUMMARY" | jq -e '.ok' > /dev/null; then
  record_pass "/api/v1/artist/lookup returns array"
else
  record_fail "/api/v1/artist/lookup did not return array — body shape regression"
fi

if echo "$LOOKUP_SUMMARY" | jq -e '.foreignArtistIdEmpty == false' > /dev/null; then
  record_pass "foreignArtistId is populated"
else
  record_fail "foreignArtistId is empty — Lidarr will reject this artist (re-enable MB to fix)"
fi

if echo "$LOOKUP_SUMMARY" | jq -e '.firstAlbumDateIsoLike' > /dev/null; then
  record_pass "firstReleaseDate is ISO 8601-like (YYYY-MM-DD…)"
else
  ACTUAL_DATE=$(echo "$LOOKUP_SUMMARY" | jq -r '.firstAlbumDate')
  record_fail "firstReleaseDate is not ISO 8601 (got: $ACTUAL_DATE) — Lidarr's date parser may reject"
fi

# Skyhook required-field presence.  Each missing field is a candidate
# cause of "Invalid response received from LidarrAPI" alongside the
# foreignArtistId issue.
for field_check in hasImages:images hasGenres:genres hasOverview:overview hasDisambiguation:disambiguation hasLinks:links hasPopularity:popularity hasStatus:status hasTags:tags; do
  field_key="${field_check%%:*}"
  field_label="${field_check##*:}"
  if echo "$LOOKUP_SUMMARY" | jq -e ".$field_key" > /dev/null; then
    record_pass "Skyhook field present: $field_label"
  else
    record_fail "Skyhook field missing: $field_label"
  fi
done

# ── 12. Recent error logs (boot noise filtered) ──────────────────
echo
echo "### Recent proxy logs (filtered for radiohead/junkyards/errors)"
pct exec "$CTID" -- docker logs --tail 200 melodarr-proxy-proxy-1 2>&1 \
  | grep -iE 'radiohead|junkyards|/api/v1/artist|/api/search|invalid|error' \
  | grep -viE 'shadowing env variable|Redis cache is not connected|Upstream not healthy at boot' \
  | tail -30 || true

# ── 13. Final summary ────────────────────────────────────────────
echo
echo "========================================"
echo "Verification summary"
echo "  Revision:         $ACTUAL_REV"
echo "  Active providers: $ACTIVE_PROVIDERS"
echo "  Tests passed:     $PASSES"
echo "  Tests failed:     $FAILS"
if [ "$PASSES" -gt 0 ]; then
  echo
  echo "Passed:"
  for p in "${PASS_LOG[@]}"; do
    echo "  ✓ $p"
  done
fi
if [ "$FAILS" -gt 0 ]; then
  echo
  echo "Failed:"
  for f in "${FAIL_LOG[@]}"; do
    echo "  ✗ $f"
  done
fi
echo "========================================"

[ "$FAILS" -gt 0 ] && exit 1
exit 0

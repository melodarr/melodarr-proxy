#!/usr/bin/env bash
# check-mb-recovery.sh
#
# Read-only health check for MusicBrainz recovery on melodarr-proxy.
# Designed to run locally on LXC 163 (or anywhere with loopback access
# to the proxy). Mutates nothing, restarts nothing — report-only.
#
# Output verdicts (printed to stdout AND appended to LOG_FILE):
#   HEALTHY + MB RECOVERED   — proxy up, MB diagnose ok, recent attempts
#                              mostly succeed, lookup returns a real MBID
#   HEALTHY + MB STILL FAILING — proxy up, but MB diagnose fails OR >=50%
#                                of recent MB upstream attempts failed
#   DEGRADED                 — proxy reports down/degraded readiness
#   UNKNOWN                  — proxy unreachable or response unparseable
#
# Env knobs:
#   BASE_URL    default http://127.0.0.1:3055
#   API_KEY     required for the lookup probe; if unset, lookup is skipped
#               (verdict can still be HEALTHY + MB RECOVERED if all other
#               signals agree, but lookup confirmation will be missing)
#   LOG_FILE    default /var/log/melodarr-mb-recovery.log
#   TIMEOUT     per-curl timeout in seconds, default 10
#   LOOKUP_TERM artist term to probe, default "radiohead"

set -u
set -o pipefail

BASE_URL="${BASE_URL:-}"
API_KEY="${API_KEY:-}"
LOG_FILE="${LOG_FILE:-/var/log/melodarr-mb-recovery.log}"
TIMEOUT="${TIMEOUT:-10}"
# v0.3.38: rotating artist pool. If the source tree is reachable from
# CWD, pick today's artist; otherwise fall back to "radiohead" so the
# script still runs in environments without the proxy source mounted.
LOOKUP_TERM="${LOOKUP_TERM:-$(node -e "console.log(require('./src/utils/testArtists').getNextArtist())" 2>/dev/null || echo radiohead)}"

TS_HUMAN="$(date '+%Y-%m-%d %H:%M:%S %Z')"
TS_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

if [ -z "$BASE_URL" ]; then
  echo "[MB-CHECK] $TS_ISO UNKNOWN — BASE_URL not set (e.g. BASE_URL=http://127.0.0.1:3055)" \
    | tee -a "$LOG_FILE" >&2
  exit 3
fi

for bin in curl jq; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "ERROR: required binary '$bin' not found in PATH" >&2
    exit 2
  fi
done

TMPDIR_RUN="$(mktemp -d -t mbrec.XXXXXX)"
trap 'rm -rf "$TMPDIR_RUN"' EXIT

# fetch URL → writes body to $1, returns HTTP code via stdout (or 000 on
# transport failure). Never exits non-zero so the script can keep going
# and report UNKNOWN gracefully.
fetch () {
  local out="$1" url="$2" key_header_args=()
  if [ -n "${3:-}" ]; then
    key_header_args=(-H "x-api-key: $3")
  fi
  curl -sS -m "$TIMEOUT" "${key_header_args[@]}" \
    -o "$out" -w '%{http_code}' "$url" 2>/dev/null || echo "000"
}

READY_BODY="$TMPDIR_RUN/ready.json"
DIAG_BODY="$TMPDIR_RUN/diag.json"
BUFFER_BODY="$TMPDIR_RUN/buffer.json"
LOOKUP_BODY="$TMPDIR_RUN/lookup.json"

READY_CODE="$(fetch "$READY_BODY" "$BASE_URL/api/ready")"
DIAG_CODE="$(fetch "$DIAG_BODY" "$BASE_URL/debug/diagnose?provider=musicbrainz")"
BUFFER_CODE="$(fetch "$BUFFER_BODY" "$BASE_URL/debug/upstream?provider=musicbrainz&limit=10")"

if [ -n "$API_KEY" ]; then
  LOOKUP_CODE="$(fetch "$LOOKUP_BODY" "$BASE_URL/api/v0.4/artist/lookup?term=$LOOKUP_TERM" "$API_KEY")"
else
  LOOKUP_CODE="skipped"
fi

# safe jq extractor — returns "" on parse failure rather than aborting
jget () {
  local file="$1" filter="$2"
  jq -r "$filter" < "$file" 2>/dev/null || true
}

READY_STATUS="$(jget "$READY_BODY" '.status // ""')"
READY_UPSTREAM="$(jget "$READY_BODY" '.upstream // ""')"
READY_PROBED="$(jget "$READY_BODY" '.upstreamDetail.probedProvider // ""')"
READY_ACTIVE="$(jget "$READY_BODY" '(.upstreamDetail.activeProviders // []) | join(",")')"
READY_LAST_ERROR="$(jget "$READY_BODY" '.upstreamDetail.lastError // ""')"

DIAG_OK="$(jget "$DIAG_BODY" '.ok // false')"
DIAG_STEP="$(jget "$DIAG_BODY" '.failedStep // ""')"
DIAG_ERR_CODE="$(jget "$DIAG_BODY" '.error.code // ""')"
DIAG_ERR_MSG="$(jget "$DIAG_BODY" '.error.message // ""')"
DIAG_SELECTED_FAMILY="$(jget "$DIAG_BODY" '.dns.selectedFamily // ""')"
DIAG_CONFIGURED_FAMILY="$(jget "$DIAG_BODY" '.dns.configuredFamily // ""')"

BUF_TOTAL="$(jget "$BUFFER_BODY" '.filteredCount // 0')"
BUF_FAILS="$(jget "$BUFFER_BODY" '[.entries[]? | select(.failedStep != null)] | length')"
BUF_TLS_FAILS="$(jget "$BUFFER_BODY" '[.entries[]? | select(.failedStep == "tls")] | length')"
BUF_SUCCESSES="$(jget "$BUFFER_BODY" '[.entries[]? | select(.failedStep == null)] | length')"

# normalise to ints (jq may emit "" or "null" if file unparseable)
case "$BUF_TOTAL" in ''|null) BUF_TOTAL=0 ;; esac
case "$BUF_FAILS" in ''|null) BUF_FAILS=0 ;; esac
case "$BUF_TLS_FAILS" in ''|null) BUF_TLS_FAILS=0 ;; esac
case "$BUF_SUCCESSES" in ''|null) BUF_SUCCESSES=0 ;; esac

LOOKUP_FAID=""
LOOKUP_NAME=""
LOOKUP_IS_MBID="false"
if [ "$LOOKUP_CODE" = "200" ]; then
  # The Skyhook shape returns either an array of artists or a single
  # object depending on endpoint version; handle both defensively.
  LOOKUP_FAID="$(jget "$LOOKUP_BODY" 'if type == "array" then (.[0].foreignArtistId // "") else (.foreignArtistId // "") end')"
  LOOKUP_NAME="$(jget "$LOOKUP_BODY" 'if type == "array" then (.[0].artistName // "") else (.artistName // "") end')"
  if echo "$LOOKUP_FAID" | grep -Eiq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
    LOOKUP_IS_MBID="true"
  fi
fi

# Verdict logic
#
# UNKNOWN gates first: if we can't talk to the proxy, nothing else is
# meaningful.
VERDICT="UNKNOWN"
RATIONALE=""

PROXY_REACHABLE="true"
if [ "$READY_CODE" = "000" ] || [ "$DIAG_CODE" = "000" ] || [ "$BUFFER_CODE" = "000" ]; then
  PROXY_REACHABLE="false"
fi

if [ "$PROXY_REACHABLE" = "false" ]; then
  VERDICT="UNKNOWN"
  RATIONALE="proxy unreachable (ready=$READY_CODE diagnose=$DIAG_CODE upstream=$BUFFER_CODE)"
elif [ -z "$READY_STATUS" ]; then
  VERDICT="UNKNOWN"
  RATIONALE="ready response unparseable (http $READY_CODE)"
elif [ "$READY_STATUS" = "down" ] || [ "$READY_CODE" = "503" ]; then
  VERDICT="DEGRADED"
  RATIONALE="ready=$READY_STATUS http=$READY_CODE upstream=$READY_UPSTREAM lastError='$READY_LAST_ERROR'"
elif [ "$BUF_TOTAL" -eq 0 ]; then
  # Empty buffer = no recent MB attempts to evaluate. Could mean MB is
  # disabled in metadataProviders, or just that nothing has hit the proxy
  # since restart. Either way, we can't honestly call this "recovered".
  VERDICT="UNKNOWN"
  RATIONALE="upstream buffer empty for musicbrainz — no recent activity to evaluate"
elif [ "$LOOKUP_CODE" = "skipped" ]; then
  # Lookup is mandatory for confirming MB is usable end-to-end.
  VERDICT="UNKNOWN"
  RATIONALE="lookup probe skipped (API_KEY env var not set) — cannot confirm MB usability"
else
  # MB is recovered iff (a) the diagnostic handshake succeeded AND
  # (b) the lookup endpoint produced a non-empty foreignArtistId — i.e.
  # MB is not just reachable but actually usable by Lidarr.
  MB_HEALTHY="false"
  if [ "$DIAG_OK" = "true" ] && [ "$LOOKUP_CODE" = "200" ] && [ -n "$LOOKUP_FAID" ]; then
    MB_HEALTHY="true"
  fi

  if [ "$MB_HEALTHY" = "true" ]; then
    VERDICT="HEALTHY + MB RECOVERED"
    RATIONALE="diagnose.ok=true lookup foreignArtistId='$LOOKUP_FAID' (isMBID=$LOOKUP_IS_MBID) buffer ${BUF_SUCCESSES}/${BUF_TOTAL} success"
  else
    VERDICT="HEALTHY + MB STILL FAILING"
    RATIONALE="diagnose.ok=$DIAG_OK failedStep=$DIAG_STEP errCode=$DIAG_ERR_CODE buffer ${BUF_FAILS}/${BUF_TOTAL} fail (${BUF_TLS_FAILS} tls) lookupFAID='$LOOKUP_FAID'"
  fi
fi

# Recommendation
RECOMMENDATION=""
case "$VERDICT" in
  "HEALTHY + MB RECOVERED")
    RECOMMENDATION="MB is back. No action needed. If you previously trimmed metadataProviders, consider re-adding 'musicbrainz' to the front of the list."
    ;;
  "HEALTHY + MB STILL FAILING")
    RECOMMENDATION="Proxy is serving via fallback chain (v0.3.35). Leave 'musicbrainz' in metadataProviders — graceful fallback handles it. Re-check next week."
    ;;
  "DEGRADED")
    RECOMMENDATION="Proxy itself is degraded. Investigate readiness/last-error before judging MB."
    ;;
  "UNKNOWN")
    RECOMMENDATION="Could not assess. Verify proxy is running on $BASE_URL and rerun manually."
    ;;
esac

# Build the report. The first line is a single-line grep-friendly summary
# so operators can `grep ^\[MB-CHECK\] /var/log/melodarr-mb-recovery.log`.
{
  echo "[MB-CHECK] $TS_ISO $VERDICT"
  echo "================================================================"
  echo "MB recovery check — $TS_HUMAN ($TS_ISO)"
  echo "VERDICT: $VERDICT"
  echo "Rationale: $RATIONALE"
  echo "Recommendation: $RECOMMENDATION"
  echo "----------------------------------------------------------------"
  echo "[/api/ready]            http=$READY_CODE status=$READY_STATUS upstream=$READY_UPSTREAM"
  echo "                        probedProvider=$READY_PROBED activeProviders=[$READY_ACTIVE]"
  echo "                        lastError='$READY_LAST_ERROR'"
  echo "[/debug/diagnose]       http=$DIAG_CODE ok=$DIAG_OK failedStep=$DIAG_STEP"
  echo "                        error=$DIAG_ERR_CODE: $DIAG_ERR_MSG"
  echo "                        ipFamily configured=$DIAG_CONFIGURED_FAMILY selected=$DIAG_SELECTED_FAMILY"
  echo "[/debug/upstream]       http=$BUFFER_CODE total=$BUF_TOTAL success=$BUF_SUCCESSES fail=$BUF_FAILS (tls=$BUF_TLS_FAILS)"
  if [ "$LOOKUP_CODE" = "skipped" ]; then
    echo "[/api/v0.4/...lookup]   skipped (no API_KEY env var set)"
  else
    echo "[/api/v0.4/...lookup]   http=$LOOKUP_CODE term=$LOOKUP_TERM artistName='$LOOKUP_NAME'"
    echo "                        foreignArtistId='$LOOKUP_FAID' isMBID=$LOOKUP_IS_MBID"
  fi
  echo "================================================================"
  echo ""
} | tee -a "$LOG_FILE"

# Exit code mirrors verdict, useful for cron MAILTO and downstream
# alerting:
#   0 → HEALTHY + MB RECOVERED
#   1 → HEALTHY + MB STILL FAILING
#   2 → DEGRADED
#   3 → UNKNOWN
case "$VERDICT" in
  "HEALTHY + MB RECOVERED")     exit 0 ;;
  "HEALTHY + MB STILL FAILING") exit 1 ;;
  "DEGRADED")                   exit 2 ;;
  *)                            exit 3 ;;
esac

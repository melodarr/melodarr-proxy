#!/usr/bin/env bash
#
# cleanup-lidarr-artists.sh — remove Lidarr library entries with empty
# or missing foreignArtistId (MBID). These are artists Lidarr accepted
# from the proxy when MB was unreachable; without an MBID they cannot
# be refreshed, monitored, or downloaded against. Cleanup makes room
# for a clean re-add once MB connectivity is restored.
#
# DRY RUN by default. Set APPLY=1 to actually delete. The dry-run
# emits exactly what would be deleted (and what would be kept) so you
# can verify the criteria before committing to destruction.
#
# Env:
#   LIDARR_URL       default http://127.0.0.1:8686
#   LIDARR_API_KEY   required
#   APPLY            "1" to actually delete; anything else = dry run
#   DELETE_FILES     "true" to also delete downloaded files; default false
#                    (only files in Lidarr's tracking, not the music
#                    files themselves unless Lidarr manages them)

set -euo pipefail

LIDARR_URL="${LIDARR_URL:-http://127.0.0.1:8686}"
API_KEY="${LIDARR_API_KEY:-}"
APPLY="${APPLY:-0}"
DELETE_FILES="${DELETE_FILES:-false}"

if [ -z "$API_KEY" ]; then
  echo "ERROR: LIDARR_API_KEY required"
  echo "Usage: LIDARR_API_KEY=xxx [LIDARR_URL=http://...] [APPLY=1] $0"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required but not installed"
  exit 1
fi

if [ "$APPLY" = "1" ]; then
  MODE="LIVE — will delete"
else
  MODE="DRY RUN — preview only (set APPLY=1 to actually delete)"
fi

echo "========================================"
echo "Lidarr orphan-artist cleanup"
echo "Mode:           $MODE"
echo "Lidarr URL:     $LIDARR_URL"
echo "Delete files:   $DELETE_FILES"
echo "========================================"
echo

# Fetch all artists. Capture HTTP code separately so we don't try to
# pipe a 4xx error body through jq.
TMP_BODY=$(mktemp)
trap 'rm -f "$TMP_BODY"' EXIT

HTTP_CODE=$(curl -s -o "$TMP_BODY" -w '%{http_code}' \
  -H "X-Api-Key: $API_KEY" \
  "$LIDARR_URL/api/v1/artist")

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: Lidarr /api/v1/artist returned HTTP $HTTP_CODE"
  echo "Body: $(head -c 200 "$TMP_BODY")"
  exit 1
fi

INSPECTED=0
ELIGIBLE=0
DELETED=0
ERRORS=0

# Iterate. Use process substitution so the counters survive (vs. piping
# into a subshell which would discard our incremented vars).
while IFS= read -r artist; do
  INSPECTED=$((INSPECTED + 1))
  ID=$(echo "$artist" | jq -r '.id')
  NAME=$(echo "$artist" | jq -r '.artistName // "<no name>"')
  MBID=$(echo "$artist" | jq -r '.foreignArtistId // ""')

  if [ -z "$MBID" ] || [ "$MBID" = "null" ]; then
    ELIGIBLE=$((ELIGIBLE + 1))
    if [ "$APPLY" = "1" ]; then
      DEL_HTTP=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE \
        -H "X-Api-Key: $API_KEY" \
        "$LIDARR_URL/api/v1/artist/$ID?deleteFiles=$DELETE_FILES")
      if [ "$DEL_HTTP" = "200" ] || [ "$DEL_HTTP" = "204" ]; then
        echo "  ✓ deleted: $NAME (id=$ID)"
        DELETED=$((DELETED + 1))
      else
        echo "  ✗ delete failed (HTTP $DEL_HTTP): $NAME (id=$ID)"
        ERRORS=$((ERRORS + 1))
      fi
    else
      echo "  [would delete] $NAME (id=$ID)"
    fi
  fi
done < <(jq -c '.[]' < "$TMP_BODY")

echo
echo "========================================"
echo "Inspected:      $INSPECTED"
echo "Eligible:       $ELIGIBLE  (empty foreignArtistId)"
if [ "$APPLY" = "1" ]; then
  echo "Deleted:        $DELETED"
  echo "Errors:         $ERRORS"
  if [ "$ERRORS" -gt 0 ]; then
    echo "========================================"
    echo "WARNING: $ERRORS artists could not be deleted (see lines above)"
    exit 1
  fi
else
  echo "Mode was DRY RUN — re-run with APPLY=1 to actually delete."
fi
echo "========================================"

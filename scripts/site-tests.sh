#!/usr/bin/env bash
set -euo pipefail

CTID="${CTID:-163}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3055}"
API_KEY="${API_KEY:-}"

echo "Melodarr v0.3.35 verification"
echo "CTID=$CTID"
echo "BASE_URL=$BASE_URL"

echo
echo "## Disk check"
pct exec "$CTID" -- bash -lc 'df -h /var/lib/docker 2>/dev/null; docker system df'

echo
echo "## Deploy proxy only"
pct exec "$CTID" -- bash -lc 'cd /opt/melodarr-proxy && docker compose pull proxy && docker compose up -d --force-recreate proxy'

sleep 5

echo
echo "## Version check"
pct exec "$CTID" -- curl -s "$BASE_URL/api/version" | jq

echo
echo "## Search endpoint should not 502"
pct exec "$CTID" -- bash -lc "curl -i -s ${API_KEY:+-H \"X-Api-Key: $API_KEY\"} '$BASE_URL/api/search?type=all&query=junkyards' | head -1"

echo
echo "## Search response summary"
pct exec "$CTID" -- bash -lc "curl -s ${API_KEY:+-H \"X-Api-Key: $API_KEY\"} '$BASE_URL/api/search?type=all&query=junkyards'" \
| jq 'if type == "object" then {has_albums: (.albums // [] | length > 0), partial, warning} else {count: length} end'

echo
echo "## Artist discover should not 502"
pct exec "$CTID" -- bash -lc "curl -i -s ${API_KEY:+-H \"X-Api-Key: $API_KEY\"} '$BASE_URL/api/v1/artist/discover?q=junkyards' | head -1"

echo
echo "## Artist discover response summary"
pct exec "$CTID" -- bash -lc "curl -s ${API_KEY:+-H \"X-Api-Key: $API_KEY\"} '$BASE_URL/api/v1/artist/discover?q=junkyards'" \
| jq '{providers, partial, warning, candidate_count: (.candidates // [] | length)}'

echo
echo "## PII/config leak check"
pct exec "$CTID" -- bash -lc '
BASE_URL="'"$BASE_URL"'"
API_KEY="'"$API_KEY"'"

for path in "/api/search?type=all&query=junkyards" "/api/v1/artist/discover?q=junkyards"; do
  echo "=== $path ==="

  if [ -n "$API_KEY" ]; then
    body=$(curl -s "$BASE_URL${path}" -H "X-Api-Key: $API_KEY")
  else
    body=$(curl -s "$BASE_URL${path}")
  fi

  leak=0
  for needle in "jcwalker3" "yahoo.com" "musicbrainz.org" "Lunar Bridge" "User-Agent" "\"fmt\"" "\"limit\""; do
    if echo "$body" | grep -qi "$needle"; then
      echo "  LEAK: response contains: $needle"
      leak=1
    fi
  done

  [ "$leak" = 0 ] && echo "  CLEAN: no PII or upstream-config strings found"
done
'

echo
echo "## Ready/provider status"
pct exec "$CTID" -- curl -s "$BASE_URL/api/ready" \
| jq '{upstream, probedProvider: .upstreamDetail.probedProvider, activeProviders: .upstreamDetail.activeProviders}'

echo
echo "## Upstream buffer provider counts"
pct exec "$CTID" -- curl -s "$BASE_URL/debug/upstream?limit=20" \
| jq '[.entries[].provider] | group_by(.) | map({provider: .[0], count: length})'

echo
echo "## Lidarr response-shape checks"

echo
echo "### /api/search raw response"
pct exec "$CTID" -- bash -lc "curl -i -s ${API_KEY:+-H \"X-Api-Key: $API_KEY\"} '$BASE_URL/api/search?type=all&query=radiohead' | head -80"

echo
echo "### /api/v1/artist lookup raw response"
pct exec "$CTID" -- bash -lc "curl -i -s ${API_KEY:+-H \"X-Api-Key: $API_KEY\"} '$BASE_URL/api/v1/artist?term=radiohead' | head -80"

echo
echo "### /api/v1/artist/discover raw response"
pct exec "$CTID" -- bash -lc "curl -i -s ${API_KEY:+-H \"X-Api-Key: $API_KEY\"} '$BASE_URL/api/v1/artist/discover?q=radiohead' | head -80"

echo
echo "### Validate /api/v1/artist returns Lidarr-style array"
pct exec "$CTID" -- bash -lc "curl -s ${API_KEY:+-H \"X-Api-Key: $API_KEY\"} '$BASE_URL/api/v1/artist?term=radiohead'" \
| jq '
  if type == "array" then
    {
      ok: true,
      count: length,
      first: (.[0] // {}),
      hasArtistName: (.[0] | has("artistName")),
      hasForeignArtistId: (.[0] | has("foreignArtistId")),
      foreignArtistId: (.[0].foreignArtistId // null),
      hasAlbums: (.[0] | has("albums")),
      albumsType: (.[0].albums | type)
    }
  else
    {
      ok: false,
      type: type,
      body: .
    }
  end
'

echo
echo "### Recent proxy logs for Lidarr/search errors"
pct exec "$CTID" -- docker logs --tail 200 melodarr-proxy-proxy-1 2>&1 \
| grep -iE 'radiohead|junkyards|/api/v1/search|/api/v1/artist|/api/search|invalid|error|warn' \
| tail -30 || true

echo
echo "## Lidarr-compatible artist lookup endpoint"

echo
echo "### /api/v1/artist/lookup raw response"
pct exec "$CTID" -- bash -lc "curl -i -s ${API_KEY:+-H \"X-Api-Key: $API_KEY\"} '$BASE_URL/api/v1/artist/lookup?term=Radiohead' | head -100"

echo
echo "### /api/v0.4/artist/lookup raw response"
pct exec "$CTID" -- bash -lc "curl -i -s ${API_KEY:+-H \"X-Api-Key: $API_KEY\"} '$BASE_URL/api/v0.4/artist/lookup?term=Radiohead' | head -100"

echo
echo "### Validate /api/v1/artist/lookup Lidarr shape"
pct exec "$CTID" -- bash -lc "curl -s ${API_KEY:+-H \"X-Api-Key: $API_KEY\"} '$BASE_URL/api/v1/artist/lookup?term=Radiohead'" \
| jq '
  if type == "array" then
    {
      ok: true,
      count: length,
      firstArtistName: (.[0].artistName // null),
      hasArtistName: (.[0] | has("artistName")),
      hasForeignArtistId: (.[0] | has("foreignArtistId")),
      foreignArtistId: (.[0].foreignArtistId // null),
      foreignArtistIdEmpty: ((.[0].foreignArtistId // "") == ""),
      hasAlbums: (.[0] | has("albums")),
      albumsType: (.[0].albums | type),
      albumCount: (.[0].albums // [] | length),
      providers: (.[0].providers // [])
    }
  else
    {
      ok: false,
      type: type,
      body: .
    }
  end
'

echo
echo "### Validate /api/v0.4/artist/lookup Lidarr shape"
pct exec "$CTID" -- bash -lc "curl -s ${API_KEY:+-H \"X-Api-Key: $API_KEY\"} '$BASE_URL/api/v0.4/artist/lookup?term=Radiohead'" \
| jq '
  if type == "array" then
    {
      ok: true,
      count: length,
      firstArtistName: (.[0].artistName // null),
      hasArtistName: (.[0] | has("artistName")),
      hasForeignArtistId: (.[0] | has("foreignArtistId")),
      foreignArtistId: (.[0].foreignArtistId // null),
      foreignArtistIdEmpty: ((.[0].foreignArtistId // "") == ""),
      hasAlbums: (.[0] | has("albums")),
      albumsType: (.[0].albums | type),
      albumCount: (.[0].albums // [] | length),
      providers: (.[0].providers // [])
    }
  else
    {
      ok: false,
      type: type,
      body: .
    }
  end
'

echo
echo "Verification complete."
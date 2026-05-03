#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LIDARR_IMAGE="${LIDARR_IMAGE:-ghcr.io/hotio/lidarr:pr-plugins}"
LIDARR_CONTAINER="${LIDARR_CONTAINER:-melodarr-lidarr-smoke}"
LIDARR_API_KEY="${LIDARR_API_KEY:-0123456789abcdef0123456789abcdef}"
LIDARR_ARTIST_MBID="${LIDARR_ARTIST_MBID:-2f569e60-0a1b-4fb9-95a4-3dc1525d1aad}"
LIDARR_ARTIST_NAME="${LIDARR_ARTIST_NAME:-Backstreet Boys}"
KEEP_LIDARR_SMOKE="${KEEP_LIDARR_SMOKE:-0}"

tmp_dir=""
mock_pid=""
proxy_pid=""

free_port() {
  node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close();})"
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local max="${3:-60}"

  for _ in $(seq 1 "$max"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "OK ${label}: ${url}"
      return 0
    fi
    sleep 2
  done

  echo "FAIL ${label}: ${url}"
  return 1
}

cleanup() {
  if [[ -n "$proxy_pid" ]]; then
    kill "$proxy_pid" >/dev/null 2>&1 || true
    wait "$proxy_pid" >/dev/null 2>&1 || true
  fi

  if [[ -n "$mock_pid" ]]; then
    kill "$mock_pid" >/dev/null 2>&1 || true
    wait "$mock_pid" >/dev/null 2>&1 || true
  fi

  if [[ "$KEEP_LIDARR_SMOKE" != "1" ]]; then
    docker rm -f "$LIDARR_CONTAINER" >/dev/null 2>&1 || true
    if [[ -n "$tmp_dir" ]]; then
      rm -rf "$tmp_dir"
    fi
  else
    echo "Keeping Lidarr smoke container and data:"
    echo "  container: $LIDARR_CONTAINER"
    echo "  data: $tmp_dir"
  fi
}
trap cleanup EXIT

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $1"
    exit 1
  fi
}

require_cmd curl
require_cmd docker
require_cmd node
require_cmd python3

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/melodarr-lidarr-smoke.XXXXXX")"
mkdir -p "$tmp_dir/config" "$tmp_dir/music"

mock_port="$(free_port)"
proxy_port="$(free_port)"

PORT="$mock_port" LIDARR_SMOKE_ARTIST_MBID="$LIDARR_ARTIST_MBID" \
  node scripts/lidarr-smoke-musicbrainz-mock.js >"$tmp_dir/musicbrainz-mock.log" 2>&1 &
mock_pid="$!"

wait_for_http "http://127.0.0.1:${mock_port}/ws/2/artist/${LIDARR_ARTIST_MBID}?fmt=json&inc=aliases" "MusicBrainz mock" 10

PORT="$proxy_port" \
REQUIRE_API_KEY=false \
MUSICBRAINZ_BASE_URL="http://127.0.0.1:${mock_port}/ws/2" \
MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS=0 \
METADATA_PROVIDERS=musicbrainz \
PROVIDER_PRIORITY=musicbrainz \
REDIS_URL=redis://127.0.0.1:1 \
node src/server.js >"$tmp_dir/proxy.log" 2>&1 &
proxy_pid="$!"

wait_for_http "http://127.0.0.1:${proxy_port}/api/health" "proxy health" 30

cat > "$tmp_dir/config/config.xml" <<XML
<Config>
  <Port>8686</Port>
  <UrlBase></UrlBase>
  <BindAddress>*</BindAddress>
  <SslPort>6868</SslPort>
  <EnableSsl>False</EnableSsl>
  <LaunchBrowser>False</LaunchBrowser>
  <ApiKey>${LIDARR_API_KEY}</ApiKey>
  <AuthenticationMethod>None</AuthenticationMethod>
  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>
  <Branch>develop</Branch>
  <LogLevel>info</LogLevel>
</Config>
XML

docker rm -f "$LIDARR_CONTAINER" >/dev/null 2>&1 || true

echo "Starting disposable Lidarr container from ${LIDARR_IMAGE}..."
docker run -d \
  --name "$LIDARR_CONTAINER" \
  --add-host=host.docker.internal:host-gateway \
  -p 127.0.0.1::8686 \
  -v "$tmp_dir/config:/config" \
  -v "$tmp_dir/music:/music" \
  "$LIDARR_IMAGE" >/dev/null

lidarr_port=""
for _ in $(seq 1 30); do
  lidarr_port="$(docker port "$LIDARR_CONTAINER" 8686/tcp 2>/dev/null | sed -E 's/.*:([0-9]+)$/\1/' | tail -1)"
  if [[ -n "$lidarr_port" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$lidarr_port" ]]; then
  echo "ERROR: unable to resolve Lidarr host port"
  docker logs --tail=120 "$LIDARR_CONTAINER" || true
  exit 1
fi

lidarr_base="http://127.0.0.1:${lidarr_port}"
wait_for_http "${lidarr_base}/api/v1/system/status?apikey=${LIDARR_API_KEY}" "Lidarr API" 120 || {
  docker logs --tail=160 "$LIDARR_CONTAINER" || true
  exit 1
}

docker stop "$LIDARR_CONTAINER" >/dev/null

metadata_source="http://host.docker.internal:${proxy_port}/api/"
python3 - "$tmp_dir/config/lidarr.db" "$metadata_source" <<'PY'
import sqlite3
import sys

db_path, metadata_source = sys.argv[1], sys.argv[2]
conn = sqlite3.connect(db_path)
try:
    cur = conn.execute("UPDATE Config SET Value = ? WHERE Key = 'metadatasource'", (metadata_source,))
    if cur.rowcount == 0:
        conn.execute("INSERT INTO Config (Key, Value) VALUES (?, ?)", ("metadatasource", metadata_source))
    conn.commit()
finally:
    conn.close()
PY

docker start "$LIDARR_CONTAINER" >/dev/null
lidarr_port="$(docker port "$LIDARR_CONTAINER" 8686/tcp 2>/dev/null | sed -E 's/.*:([0-9]+)$/\1/' | tail -1)"
lidarr_base="http://127.0.0.1:${lidarr_port}"
wait_for_http "${lidarr_base}/api/v1/system/status?apikey=${LIDARR_API_KEY}" "Lidarr API after metadata-source update" 180 || {
  docker logs --tail=160 "$LIDARR_CONTAINER" || true
  exit 1
}

root_status="$(curl -sS -o "$tmp_dir/rootfolder.json" -w '%{http_code}' \
  -X POST "${lidarr_base}/api/v1/rootfolder?apikey=${LIDARR_API_KEY}" \
  -H 'content-type: application/json' \
  --data '{
    "name": "Smoke Music",
    "path": "/music",
    "defaultQualityProfileId": 1,
    "defaultMetadataProfileId": 1,
    "defaultMonitorOption": "all",
    "defaultNewItemMonitorOption": "all"
  }')"

if [[ "$root_status" != "200" && "$root_status" != "201" && "$root_status" != "202" && "$root_status" != "400" ]]; then
  echo "ERROR: failed to create Lidarr root folder: HTTP ${root_status}"
  cat "$tmp_dir/rootfolder.json"
  exit 1
fi

cat > "$tmp_dir/add-artist.json" <<JSON
{
  "status": "continuing",
  "ended": false,
  "artistName": "${LIDARR_ARTIST_NAME}",
  "foreignArtistId": "${LIDARR_ARTIST_MBID}",
  "tadbId": 0,
  "discogsId": 0,
  "overview": "",
  "disambiguation": "",
  "links": [],
  "nextAlbum": null,
  "lastAlbum": null,
  "images": [],
  "remotePoster": "",
  "qualityProfileId": 1,
  "metadataProfileId": 1,
  "monitored": true,
  "monitorNewItems": "all",
  "rootFolderPath": "/music",
  "folder": "${LIDARR_ARTIST_NAME}",
  "genres": [],
  "tags": [],
  "ratings": { "votes": 0, "value": 0 },
  "addOptions": { "monitor": "all", "searchForMissingAlbums": false }
}
JSON

add_status="$(curl -sS -o "$tmp_dir/add-response.json" -w '%{http_code}' \
  -X POST "${lidarr_base}/api/v1/artist?apikey=${LIDARR_API_KEY}" \
  -H 'content-type: application/json' \
  --data-binary "@$tmp_dir/add-artist.json")"

if grep -qi 'ArtistMetadata.Aliases' "$tmp_dir/add-response.json"; then
  echo "ERROR: Lidarr returned ArtistMetadata.Aliases constraint failure"
  cat "$tmp_dir/add-response.json"
  exit 1
fi

if [[ "$add_status" -lt 200 || "$add_status" -ge 300 ]]; then
  echo "ERROR: Lidarr add artist failed: HTTP ${add_status}"
  cat "$tmp_dir/add-response.json"
  echo
  echo "--- Lidarr logs ---"
  docker logs --tail=160 "$LIDARR_CONTAINER" || true
  echo
  echo "--- Proxy logs ---"
  cat "$tmp_dir/proxy.log" || true
  exit 1
fi

echo "OK Lidarr POST /api/v1/artist returned HTTP ${add_status}"
cat "$tmp_dir/add-response.json"
echo
echo "Lidarr add-artist smoke test passed."

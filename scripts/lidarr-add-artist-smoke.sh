#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LIDARR_IMAGE="${LIDARR_IMAGE:-ghcr.io/hotio/lidarr:pr-plugins}"
LIDARR_CONTAINER="${LIDARR_CONTAINER:-melodarr-lidarr-smoke}"
LIDARR_API_KEY="${LIDARR_API_KEY:-0123456789abcdef0123456789abcdef}"
LIDARR_ARTIST_MBID="${LIDARR_ARTIST_MBID:-2f569e60-0a1b-4fb9-95a4-3dc1525d1aad}"
LIDARR_RELEASE_GROUP_MBID="${LIDARR_RELEASE_GROUP_MBID:-920a68fe-7b93-3d0e-bf73-44ac72f03dd2}"
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

PORT="$mock_port" LIDARR_SMOKE_ARTIST_MBID="$LIDARR_ARTIST_MBID" LIDARR_SMOKE_RELEASE_GROUP_MBID="$LIDARR_RELEASE_GROUP_MBID" \
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

curl -fsS "http://127.0.0.1:${mock_port}/__counts" > "$tmp_dir/mock-counts-before-add.json"

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

artist_id="$(python3 - "$tmp_dir/add-response.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)

print(data.get("id", ""))
PY
)"

if [[ -z "$artist_id" ]]; then
  echo "ERROR: Lidarr add response did not include artist id"
  cat "$tmp_dir/add-response.json"
  exit 1
fi

artist_status="$(curl -sS -o "$tmp_dir/artist-response.json" -w '%{http_code}' \
  "${lidarr_base}/api/v1/artist/${artist_id}?apikey=${LIDARR_API_KEY}")"

if [[ "$artist_status" -lt 200 || "$artist_status" -ge 300 ]]; then
  echo "ERROR: Lidarr artist lookup failed after add: HTTP ${artist_status}"
  cat "$tmp_dir/artist-response.json"
  exit 1
fi

python3 - "$tmp_dir/artist-response.json" "$LIDARR_ARTIST_MBID" "$LIDARR_ARTIST_NAME" <<'PY'
import json
import sys

path, expected_mbid, expected_name = sys.argv[1:4]
with open(path, encoding="utf-8") as f:
    artist = json.load(f)

errors = []
if str(artist.get("foreignArtistId") or "") != expected_mbid:
    errors.append(f"foreignArtistId={artist.get('foreignArtistId')!r}")
if not artist.get("artistName"):
    errors.append("artistName is empty")
if expected_name and artist.get("artistName") != expected_name:
    errors.append(f"artistName={artist.get('artistName')!r}")

if errors:
    raise SystemExit("Lidarr persisted artist does not match metadata contract: " + ", ".join(errors))

album_types = artist.get("albumTypes")
statistics = artist.get("statistics") if isinstance(artist.get("statistics"), dict) else {}
print(f"OK Lidarr /api/v1/artist/{artist.get('id')} persisted artist metadata; albumTypes={album_types!r}, statistics.albumCount={statistics.get('albumCount')!r}")
PY

album_status="000"
album_count="0"
album_summary='{"count":0,"first":{}}'

for _ in $(seq 1 30); do
  album_status="$(curl -sS -o "$tmp_dir/albums-response.json" -w '%{http_code}' \
    "${lidarr_base}/api/v1/album?artistId=${artist_id}&apikey=${LIDARR_API_KEY}")"

  if [[ "$album_status" -lt 200 || "$album_status" -ge 300 ]]; then
    break
  fi

  album_summary="$(python3 - "$tmp_dir/albums-response.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)

albums = data.get("records") if isinstance(data, dict) else data
albums = albums if isinstance(albums, list) else []
summary = {
    "count": len(albums),
    "first": albums[0] if albums else {}
}
print(json.dumps(summary))
PY
)"
  album_count="$(python3 - "$album_summary" <<'PY'
import json
import sys
print(json.loads(sys.argv[1]).get("count", 0))
PY
)"

  if [[ "$album_count" -ge 1 ]]; then
    break
  fi

  sleep 1
done

if [[ "$album_status" -lt 200 || "$album_status" -ge 300 ]]; then
  echo "ERROR: Lidarr album lookup failed after add: HTTP ${album_status}"
  cat "$tmp_dir/albums-response.json"
  exit 1
fi

if [[ "$album_count" -lt 1 ]]; then
  echo "ERROR: Lidarr add succeeded, but /api/v1/album returned no albums for artistId=${artist_id}"
  echo "--- Lidarr albums response ---"
  cat "$tmp_dir/albums-response.json"
  echo
  echo "--- Proxy metadata response ---"
  curl -sS "http://127.0.0.1:${proxy_port}/api/artist/${LIDARR_ARTIST_MBID}" || true
  echo
  echo "--- Lidarr logs ---"
  docker logs --tail=160 "$LIDARR_CONTAINER" || true
  echo
  echo "--- Proxy logs ---"
  cat "$tmp_dir/proxy.log" || true
  echo
  echo "--- MusicBrainz mock counts ---"
  curl -fsS "http://127.0.0.1:${mock_port}/__counts" || true
  echo
  exit 1
fi

echo "OK Lidarr /api/v1/album returned ${album_count} album(s) for artistId=${artist_id}"

lidarr_album_id="$(python3 - "$album_summary" <<'PY'
import json
import sys
album = (json.loads(sys.argv[1]).get("first") or {})
print(album.get("id", ""))
PY
)"

if [[ -z "$lidarr_album_id" ]]; then
  echo "ERROR: Lidarr album response did not include local album id"
  cat "$tmp_dir/albums-response.json"
  exit 1
fi

command_status="$(curl -sS -o "$tmp_dir/refresh-album-command.json" -w '%{http_code}' \
  -X POST "${lidarr_base}/api/v1/command?apikey=${LIDARR_API_KEY}" \
  -H 'content-type: application/json' \
  --data "{\"name\":\"RefreshAlbum\",\"albumId\":${lidarr_album_id}}")"

if [[ "$command_status" -lt 200 || "$command_status" -ge 300 ]]; then
  echo "ERROR: failed to enqueue Lidarr RefreshAlbum command: HTTP ${command_status}"
  cat "$tmp_dir/refresh-album-command.json"
  exit 1
fi

command_id="$(python3 - "$tmp_dir/refresh-album-command.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
print(data.get("id", ""))
PY
)"

if [[ -n "$command_id" ]]; then
  for _ in $(seq 1 30); do
    command_state="$(curl -fsS "${lidarr_base}/api/v1/command/${command_id}?apikey=${LIDARR_API_KEY}" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)"
    if [[ "$command_state" == "completed" || "$command_state" == "failed" ]]; then
      break
    fi
    sleep 1
  done
fi

album_status_after_refresh="$(curl -sS -o "$tmp_dir/albums-after-refresh.json" -w '%{http_code}' \
  "${lidarr_base}/api/v1/album?artistId=${artist_id}&apikey=${LIDARR_API_KEY}")"
album_count_after_refresh="$(python3 - "$tmp_dir/albums-after-refresh.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
albums = data.get("records") if isinstance(data, dict) else data
print(len(albums) if isinstance(albums, list) else 0)
PY
)"

if [[ "$album_status_after_refresh" -lt 200 || "$album_status_after_refresh" -ge 300 || "$album_count_after_refresh" -lt 1 ]]; then
  echo "ERROR: Lidarr RefreshAlbum did not preserve the album"
  echo "--- Albums after refresh ---"
  cat "$tmp_dir/albums-after-refresh.json"
  echo
  echo "--- RefreshAlbum command ---"
  cat "$tmp_dir/refresh-album-command.json"
  echo
  echo "--- Lidarr logs ---"
  docker logs --tail=200 "$LIDARR_CONTAINER" || true
  echo
  echo "--- Proxy logs ---"
  cat "$tmp_dir/proxy.log" || true
  exit 1
fi

echo "OK Lidarr RefreshAlbum preserved ${album_count_after_refresh} album(s) for artistId=${artist_id}"

curl -fsS "http://127.0.0.1:${mock_port}/__counts" > "$tmp_dir/mock-counts-after-album-refresh.json"
python3 - "$tmp_dir/mock-counts-before-add.json" "$tmp_dir/mock-counts-after-album-refresh.json" "$LIDARR_ARTIST_MBID" "$LIDARR_RELEASE_GROUP_MBID" <<'PY'
import json
import sys

before_path, after_path, mbid, release_group_id = sys.argv[1:5]
with open(before_path, encoding="utf-8") as f:
    before = json.load(f)
with open(after_path, encoding="utf-8") as f:
    after = json.load(f)

limits = {
    f"/ws/2/artist/{mbid}": 1,
    "/ws/2/release-group": 1,
    f"/ws/2/release-group/{release_group_id}": 1,
    "/ws/2/release": 1,
}
errors = []
for path, limit in limits.items():
    delta = int(after.get(path, 0)) - int(before.get(path, 0))
    if delta < 1:
        errors.append(f"{path} was not called by Lidarr metadata flow")
    elif delta > limit:
        errors.append(f"{path} delta={delta}, expected <= {limit}")

if errors:
    raise SystemExit("unexpected MusicBrainz request count during Lidarr add/album refresh: " + ", ".join(errors))

print("OK MusicBrainz mock request budget: artist, release-group list, album detail, and release tracks each fetched once")
PY

python3 - "$album_summary" <<'PY'
import json
import sys

summary = json.loads(sys.argv[1])
album = summary.get("first") or {}
errors = []
if not album.get("title"):
    errors.append("title is empty")
if not (album.get("foreignAlbumId") or album.get("foreignAlbumReleaseId")):
    errors.append("foreign album id is empty")
if not (album.get("albumType") or album.get("albumTypeId") or album.get("secondaryTypes") is not None):
    errors.append("album type metadata is absent")
if errors:
    raise SystemExit("Lidarr persisted first album is incomplete: " + ", ".join(errors))

print("OK Lidarr persisted first album:", json.dumps({
    "title": album.get("title"),
    "foreignAlbumId": album.get("foreignAlbumId"),
    "albumType": album.get("albumType"),
    "releaseDate": album.get("releaseDate")
}, sort_keys=True))
PY

curl -sS -D "$tmp_dir/proxy-cache.headers" -o "$tmp_dir/proxy-cache-body.json" \
  "http://127.0.0.1:${proxy_port}/api/artist/${LIDARR_ARTIST_MBID}"

if grep -qi '^X-Cache: HIT' "$tmp_dir/proxy-cache.headers"; then
  echo "OK proxy /api/artist/${LIDARR_ARTIST_MBID} returned X-Cache: HIT after Lidarr add"
else
  echo "ERROR: proxy metadata refetch was not cached after Lidarr add"
  echo "--- Proxy cache headers ---"
  cat "$tmp_dir/proxy-cache.headers"
  echo "--- Proxy metadata body ---"
  cat "$tmp_dir/proxy-cache-body.json"
  exit 1
fi

curl -sS -D "$tmp_dir/proxy-album-cache.headers" -o "$tmp_dir/proxy-album-cache-body.json" \
  "http://127.0.0.1:${proxy_port}/api/album/${LIDARR_RELEASE_GROUP_MBID}"

if grep -qi '^X-Cache: HIT' "$tmp_dir/proxy-album-cache.headers"; then
  echo "OK proxy /api/album/${LIDARR_RELEASE_GROUP_MBID} returned X-Cache: HIT after Lidarr album refresh"
else
  echo "ERROR: proxy album refetch was not served from cache"
  echo "--- Proxy album cache headers ---"
  cat "$tmp_dir/proxy-album-cache.headers"
  echo "--- Proxy album metadata body ---"
  cat "$tmp_dir/proxy-album-cache-body.json"
  exit 1
fi

curl -fsS "http://127.0.0.1:${mock_port}/__counts" > "$tmp_dir/mock-counts-after-cache-check.json"
python3 - "$tmp_dir/mock-counts-after-album-refresh.json" "$tmp_dir/mock-counts-after-cache-check.json" "$LIDARR_ARTIST_MBID" "$LIDARR_RELEASE_GROUP_MBID" <<'PY'
import json
import sys

before_path, after_path, mbid, release_group_id = sys.argv[1:5]
with open(before_path, encoding="utf-8") as f:
    before = json.load(f)
with open(after_path, encoding="utf-8") as f:
    after = json.load(f)

watched = [
    f"/ws/2/artist/{mbid}",
    "/ws/2/release-group",
    f"/ws/2/release-group/{release_group_id}",
    "/ws/2/release",
]
errors = []
for path in watched:
    delta = int(after.get(path, 0)) - int(before.get(path, 0))
    if delta != 0:
        errors.append(f"{path} delta={delta}")

if errors:
    raise SystemExit("proxy cache check caused extra upstream MusicBrainz calls: " + ", ".join(errors))

print("OK proxy cache proof: repeated artist and album metadata fetches made zero additional MusicBrainz calls")
PY

queue_status="$(curl -sS -o "$tmp_dir/queue-response.json" -w '%{http_code}' \
  "${lidarr_base}/api/v1/queue/details?all=true&apikey=${LIDARR_API_KEY}")"

if [[ "$queue_status" -ge 200 && "$queue_status" -lt 300 ]]; then
  queue_count="$(python3 - "$tmp_dir/queue-response.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)

records = data.get("records") if isinstance(data, dict) else data
print(len(records) if isinstance(records, list) else 0)
PY
)"
  echo "OK Lidarr /api/v1/queue/details responded (records=${queue_count}); empty queue is expected when searchForMissingAlbums=false"
else
  echo "WARN: Lidarr queue details lookup returned HTTP ${queue_status}"
  cat "$tmp_dir/queue-response.json"
fi

echo "Lidarr add-artist smoke test passed."

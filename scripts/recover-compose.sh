#!/usr/bin/env bash
# recover-compose.sh — overwrite the deployed compose.yml on a Proxmox
# LXC with a known-good template, validate, and force-recreate. Used to
# unstick installs whose compose.yml has accumulated YAML corruption
# from manual sed edits or terminal-paste indentation drift.
#
# Usage (from the Proxmox host):
#   CTID=163 ./recover-compose.sh
#
# Defaults are the standard install layout:
#   container path: /opt/melodarr-proxy/compose.yml
#   proxy port:     3055 (mapped to 3000 inside)
#   melodash port:  55026
#
# Override any of these via env vars:
#   APP_CONTACT, HOST_PORT, MELODASH_HOST_PORT, APP_VERSION,
#   MUSICBRAINZ_IP_FAMILY (default: 6), COMPOSE_IPV6_SUBNET.

set -euo pipefail

CTID="${CTID:-}"
if [[ -z "$CTID" ]]; then
  echo "Usage: CTID=<id> $0" >&2
  exit 2
fi

if [[ $EUID -ne 0 ]]; then
  echo "Run as root on the Proxmox host." >&2
  exit 2
fi

if ! command -v pct >/dev/null 2>&1; then
  echo "pct not found — this must be a Proxmox host." >&2
  exit 2
fi

if ! pct status "$CTID" >/dev/null 2>&1; then
  echo "Container $CTID does not exist." >&2
  exit 2
fi

APP_CONTACT="${APP_CONTACT:-admin@example.com}"
APP_VERSION="${APP_VERSION:-latest}"
HOST_PORT="${HOST_PORT:-3055}"
MELODASH_HOST_PORT="${MELODASH_HOST_PORT:-55026}"
COMPOSE_PATH="${COMPOSE_PATH:-/opt/melodarr-proxy/compose.yml}"
MUSICBRAINZ_IP_FAMILY="${MUSICBRAINZ_IP_FAMILY:-6}"
COMPOSE_IPV6_SUBNET="${COMPOSE_IPV6_SUBNET:-fd00:dead:beef:1::/64}"

TMP_FILE="$(mktemp -t melodarr-compose.XXXXXX.yml)"
trap 'rm -f "$TMP_FILE"' EXIT

cat > "$TMP_FILE" <<COMPOSE
services:
  proxy:
    image: ghcr.io/melodarr/melodarr-proxy:${APP_VERSION}
    restart: unless-stopped
    environment:
      PORT: 3000
      REQUIRE_API_KEY: "false"
      REDIS_URL: redis://redis:6379
      DATA_DIR: /data
      APP_NAME: melodarr-proxy
      APP_CONTACT: ${APP_CONTACT}
      METADATA_PROVIDERS: musicbrainz,itunes
      PROVIDER_PRIORITY: musicbrainz,theaudiodb,itunes,lastfm,discogs
      MUSICBRAINZ_BASE_URL: https://musicbrainz.org/ws/2
      MUSICBRAINZ_IP_FAMILY: "${MUSICBRAINZ_IP_FAMILY}"
      MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS: 1100
      CACHE_TTL_SECONDS: 86400
      UPSTREAM_TIMEOUT_MS: 8000
      SLOW_REQUEST_MS: 2000
    ports:
      - "${HOST_PORT}:3000"
    volumes:
      - melodarr_proxy_data:/data
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--save", "", "--appendonly", "no"]

  melodash:
    image: ghcr.io/melodarr/melodarr-proxy-melodash:${APP_VERSION}
    restart: unless-stopped
    environment:
      PORT: 3000
      PROXY_API_URL: http://proxy:3000/api
    ports:
      - "${MELODASH_HOST_PORT}:3000"
    depends_on:
      - proxy

volumes:
  melodarr_proxy_data:

networks:
  default:
    enable_ipv6: true
    ipam:
      config:
        - subnet: ${COMPOSE_IPV6_SUBNET}
COMPOSE

echo "Wrote temp template: $TMP_FILE"
wc -l "$TMP_FILE"

# Back up whatever is currently in the container before overwriting.
BACKUP_NAME="compose.yml.broken-$(date +%s)"
pct exec "$CTID" -- bash -lc "
  if [[ -f '${COMPOSE_PATH}' ]]; then
    cp '${COMPOSE_PATH}' '$(dirname "${COMPOSE_PATH}")/${BACKUP_NAME}'
    echo 'Backed up existing compose.yml to $(dirname "${COMPOSE_PATH}")/${BACKUP_NAME}'
  fi
"

echo "Pushing clean template to ${COMPOSE_PATH}..."
pct push "$CTID" "$TMP_FILE" "$COMPOSE_PATH"

echo "Validating YAML inside container..."
pct exec "$CTID" -- bash -lc "cd $(dirname "${COMPOSE_PATH}") && docker compose config >/dev/null"
echo "yaml ok"

echo "Pulling latest images and recreating..."
pct exec "$CTID" -- bash -lc "cd $(dirname "${COMPOSE_PATH}") && docker compose pull && docker compose up -d --force-recreate"

echo
echo "Recovery complete. Watching readiness for ~60s..."
for i in 1 2 3 4 5 6; do
  sleep 10
  if status_json=$(pct exec "$CTID" -- curl -fsS -m 5 "http://127.0.0.1:${HOST_PORT}/api/ready" 2>/dev/null); then
    upstream=$(printf '%s' "$status_json" | grep -oE '"upstream":"[^"]*"' | head -1)
    failures=$(printf '%s' "$status_json" | grep -oE '"consecutiveFailures":[0-9]+' | head -1)
    echo "  [tick ${i}] ${upstream} ${failures}"
    if [[ "$upstream" == '"upstream":"healthy"' ]]; then
      echo "Upstream is healthy."
      exit 0
    fi
  else
    echo "  [tick ${i}] /api/ready not yet responding"
  fi
done

echo
echo "Upstream did not become healthy within 60s." >&2
echo "Run 'pct exec ${CTID} -- curl -s http://127.0.0.1:${HOST_PORT}/api/ready' for the latest status." >&2
exit 1

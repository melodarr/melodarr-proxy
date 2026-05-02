#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HOST_PORT="${HOST_PORT:-3055}"
MELODASH_HOST_PORT="${MELODASH_HOST_PORT:-55026}"
DOCKER_NETWORK="${DOCKER_NETWORK:-melodarr-ipv6}"
DOCKER_IPV6_SUBNET="${DOCKER_IPV6_SUBNET:-fd00:dead:beef:1::/64}"

compose() {
  HOST_PORT="$HOST_PORT" MELODASH_HOST_PORT="$MELODASH_HOST_PORT" docker compose "$@"
}

cleanup() {
  compose down --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1; then
  docker network create --ipv6 --subnet "$DOCKER_IPV6_SUBNET" "$DOCKER_NETWORK" >/dev/null 2>&1 ||
    docker network create "$DOCKER_NETWORK" >/dev/null
fi

echo "Building and starting proxy, Redis, and Melodash..."
compose up -d --build --remove-orphans proxy redis melodash

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
  compose ps
  compose logs --tail=120 proxy melodash redis
  return 1
}

wait_for_http "http://127.0.0.1:${HOST_PORT}/api/health" "proxy health"
wait_for_http "http://127.0.0.1:${HOST_PORT}/openapi.json" "proxy openapi"
wait_for_http "http://127.0.0.1:${HOST_PORT}/docs" "proxy docs"
wait_for_http "http://127.0.0.1:${MELODASH_HOST_PORT}/dashboard" "melodash dashboard"

ready_status="$(curl -sS -o /tmp/melodarr-ready.json -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/api/ready")"
if [[ "$ready_status" -ne 200 && "$ready_status" -ne 503 ]]; then
  echo "FAIL proxy ready: HTTP ${ready_status}"
  cat /tmp/melodarr-ready.json || true
  exit 1
fi
echo "OK proxy ready: HTTP ${ready_status}"

MELODASH_BASE_URL="http://127.0.0.1:${MELODASH_HOST_PORT}" scripts/melodash-route-smoke.sh

compose ps
echo "Docker Compose smoke test passed."

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HOST_PORT="${HOST_PORT:-3055}"
MELODASH_HOST_PORT="${MELODASH_HOST_PORT:-55026}"
USE_IPV6_NETWORK="${USE_IPV6_NETWORK:-1}"
DOCKER_NETWORK="${DOCKER_NETWORK:-melodarr-ipv6}"
DOCKER_IPV6_SUBNET="${DOCKER_IPV6_SUBNET:-fd00:dead:beef:1::/64}"

use_ipv6_network() {
  [[ "$USE_IPV6_NETWORK" == "1" || "$USE_IPV6_NETWORK" == "true" || "$USE_IPV6_NETWORK" == "yes" ]]
}

compose() {
  local compose_files=(-f docker-compose.yml)
  if use_ipv6_network; then
    compose_files+=(-f docker-compose.ipv6.yml)
  fi

  HOST_PORT="$HOST_PORT" MELODASH_HOST_PORT="$MELODASH_HOST_PORT" DOCKER_NETWORK="$DOCKER_NETWORK" DOCKER_IPV6_SUBNET="$DOCKER_IPV6_SUBNET" bash scripts/docker-compose-run.sh "${compose_files[@]}" "$@"
}

cleanup() {
  compose down --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

if use_ipv6_network && ! docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1; then
  if ! docker network create --ipv6 --subnet "$DOCKER_IPV6_SUBNET" "$DOCKER_NETWORK" >/dev/null; then
    echo "FAIL Docker IPv6 network: unable to create ${DOCKER_NETWORK} (${DOCKER_IPV6_SUBNET})"
    echo "Run scripts/ensure-docker-ipv6.sh as root on the Docker host/LXC, then retry."
    exit 1
  fi
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

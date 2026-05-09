#!/usr/bin/env bash
#
# Controlled dev update script.
#
# Phase 1 scope only:
# - detect running proxy container
# - detect current version and image
# - fetch latest dev tag
# - pull image
# - restart with docker compose
# - verify /api/health
#
# Future hooks intentionally preserved:
# - `--yes` supports backend/UI callers via execFile("scripts/update-dev.sh", ["--yes"])
# - current image is captured with docker inspect for later rollback support

set -euo pipefail

AUTO_APPROVE=false
if [[ "${1:-}" == "--yes" ]]; then
  AUTO_APPROVE=true
elif [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: scripts/update-dev.sh [--yes]"
  exit 0
elif [[ -n "${1:-}" ]]; then
  echo "[ERROR] Unknown argument: $1"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

IMAGE_REPO="${IMAGE_REPO:-ghcr.io/melodarr/melodarr-proxy}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3055/api/health}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[ERROR] Required command not found: $1"
    exit 1
  fi
}

require_command docker
require_command curl
require_command jq

if ! docker compose version >/dev/null 2>&1; then
  echo "[ERROR] docker compose is required"
  exit 1
fi

CONTAINER_NAME="$(docker ps --format '{{.Names}}' | grep proxy | head -n 1 || true)"
if [[ -z "$CONTAINER_NAME" ]]; then
  echo "[ERROR] Proxy container not found"
  exit 1
fi

CURRENT_VERSION="$(docker exec "$CONTAINER_NAME" node -e "console.log(process.env.APP_VERSION || 'unknown')" 2>/dev/null || echo "unknown")"
CURRENT_IMAGE="$(docker inspect "$CONTAINER_NAME" --format '{{.Config.Image}}' 2>/dev/null || echo "unknown")"

echo "[INFO] Proxy container: $CONTAINER_NAME"
echo "[INFO] Current version: $CURRENT_VERSION"
echo "[INFO] Current image: $CURRENT_IMAGE"

LATEST_TAG="$(
  curl -s "https://ghcr.io/v2/melodarr/melodarr-proxy/tags/list" \
    | jq -r '.tags[]' \
    | grep dev \
    | sort -V \
    | tail -n 1 \
    || true
)"

if [[ -z "$LATEST_TAG" || "$LATEST_TAG" == "null" ]]; then
  echo "[ERROR] Could not determine latest dev version"
  exit 1
fi

TARGET_IMAGE="$IMAGE_REPO:$LATEST_TAG"
echo "[INFO] Latest dev tag: $LATEST_TAG"
echo "[INFO] Target image: $TARGET_IMAGE"

if [[ "$AUTO_APPROVE" = false ]]; then
  read -r -p "Proceed with update? (y/N): " CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "[INFO] Update cancelled"
    exit 0
  fi
fi

echo "[INFO] Pulling image..."
docker pull "$TARGET_IMAGE"

echo "[INFO] Restarting with docker compose..."
docker compose down
docker compose up -d

echo "[INFO] Waiting for health..."
for _ in {1..10}; do
  STATUS="$(curl -s "$HEALTH_URL" | jq -r '.status' 2>/dev/null || true)"

  if [[ "$STATUS" == "ok" ]]; then
    echo "[SUCCESS] Update successful"
    exit 0
  fi

  sleep 2
done

echo "[ERROR] Health check failed"
exit 1

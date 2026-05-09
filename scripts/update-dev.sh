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
TARGET_TAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes)
      AUTO_APPROVE=true
      shift
      ;;
    --tag)
      if [[ -z "${2:-}" ]]; then
        echo "[ERROR] --tag requires a value"
        exit 1
      fi
      TARGET_TAG="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: scripts/update-dev.sh [--yes] [--tag TAG]"
      echo ""
      echo "Options:"
      echo "  --yes        Skip confirmation prompt"
      echo "  --tag TAG    Use specific tag instead of auto-discovering latest dev tag"
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown argument: $1"
      exit 1
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

IMAGE_REPO="${IMAGE_REPO:-ghcr.io/melodarr/melodarr-proxy}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3055/api/health}"
GITHUB_ORG="melodarr"
GITHUB_PACKAGE="melodarr-proxy"

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

if ! COMPOSE_CONFIG_JSON="$(docker compose config --format json 2>/dev/null)"; then
  echo "[ERROR] Unable to read docker compose config for service detection"
  exit 1
fi

if ! COMPOSE_PROXY_IMAGE="$(jq -r '.services.proxy.image // empty' <<<"$COMPOSE_CONFIG_JSON" 2>/dev/null)"; then
  echo "[ERROR] Unable to extract proxy image from docker compose config"
  exit 1
fi

if [[ -z "$COMPOSE_PROXY_IMAGE" ]]; then
  echo "[ERROR] docker compose service 'proxy' must specify an image field; build-only compose is unsupported by this updater"
  exit 1
fi

if [[ "$COMPOSE_PROXY_IMAGE" == *"@sha224:"* || "$COMPOSE_PROXY_IMAGE" == *"@sha256:"* || "$COMPOSE_PROXY_IMAGE" == *"@sha384:"* || "$COMPOSE_PROXY_IMAGE" == *"@sha512:"* ]]; then
  echo "[ERROR] docker compose service 'proxy' image cannot be digest-pinned (tag-based images required): $COMPOSE_PROXY_IMAGE"
  exit 1
fi

CONTAINER_ID="$(docker compose ps -q proxy 2>/dev/null || true)"
if [[ -z "$CONTAINER_ID" ]]; then
  echo "[ERROR] Proxy container not found"
  exit 1
fi

if [[ "$(docker inspect "$CONTAINER_ID" --format '{{.State.Running}}' 2>/dev/null || echo "false")" != "true" ]]; then
  echo "[ERROR] Proxy container is not running"
  exit 1
fi

CONTAINER_NAME="$(docker inspect "$CONTAINER_ID" --format '{{.Name}}' 2>/dev/null | sed 's#^/##' || echo "$CONTAINER_ID")"
CURRENT_VERSION="$(docker exec "$CONTAINER_ID" node -e "console.log(process.env.APP_VERSION || 'unknown')" 2>/dev/null || echo "unknown")"
CURRENT_IMAGE="$(docker inspect "$CONTAINER_ID" --format '{{.Config.Image}}' 2>/dev/null || echo "unknown")"

# Extract compose project metadata from container labels
COMPOSE_PROJECT="$(docker inspect "$CONTAINER_ID" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)"
COMPOSE_WORKING_DIR="$(docker inspect "$CONTAINER_ID" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null || true)"
COMPOSE_CONFIG_FILES="$(docker inspect "$CONTAINER_ID" --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' 2>/dev/null || true)"

echo "[INFO] Proxy container: $CONTAINER_NAME"
echo "[INFO] Current version: $CURRENT_VERSION"
echo "[INFO] Current image: $CURRENT_IMAGE"

if [[ -n "$COMPOSE_PROJECT" ]]; then
  echo "[INFO] Compose project: $COMPOSE_PROJECT"
fi
if [[ -n "$COMPOSE_WORKING_DIR" ]]; then
  echo "[INFO] Compose working dir: $COMPOSE_WORKING_DIR"
fi
if [[ -n "$COMPOSE_CONFIG_FILES" ]]; then
  echo "[INFO] Compose config files: $COMPOSE_CONFIG_FILES"
fi

if [[ -z "$TARGET_TAG" ]]; then
  echo "[INFO] Auto-discovering latest dev tag via GitHub API..."
  
  # Helper function to extract latest dev tag from tag list
  extract_latest_dev_tag() {
    grep dev | sort -V | tail -n 1 || true
  }
  
  GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  if [[ -z "$GH_TOKEN" ]] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    GH_TOKEN="$(gh auth token 2>/dev/null || true)"
  fi

  if [[ -n "$GH_TOKEN" ]]; then
    # Query GitHub API with auth (limited to 100 most recent versions; sufficient for dev tag discovery)
    # Token passed via config file to avoid process listing exposure
    CURL_CONFIG=$(mktemp)
    trap "rm -f \"$CURL_CONFIG\"" EXIT
    printf 'header = "Authorization: Bearer %s"\n' "$GH_TOKEN" > "$CURL_CONFIG"
    chmod 600 "$CURL_CONFIG"
    
    API_RESPONSE="$(curl -sS -w "\n%{http_code}" -K "$CURL_CONFIG" \
      "https://api.github.com/orgs/$GITHUB_ORG/packages/container/$GITHUB_PACKAGE/versions?per_page=100" 2>&1)"
    CURL_EXIT=$?
    
    rm -f "$CURL_CONFIG"
    trap - EXIT
    
    if [[ $CURL_EXIT -ne 0 ]]; then
      echo "[ERROR] GitHub API request failed (exit $CURL_EXIT). Check network/auth and retry, or use --tag."
      exit 1
    fi
    
    HTTP_CODE="$(echo "$API_RESPONSE" | tail -n 1)"
    API_BODY="$(echo "$API_RESPONSE" | sed '$d')"
    
    if [[ "$HTTP_CODE" != "200" ]]; then
      echo "[ERROR] GitHub API returned HTTP $HTTP_CODE. Check auth token and retry, or use --tag."
      exit 1
    fi
    
    JQ_OUTPUT="$(echo "$API_BODY" | jq -r '.[].metadata.container.tags[]' 2>&1)"
    JQ_EXIT=$?
    if [[ $JQ_EXIT -ne 0 ]]; then
      echo "[ERROR] Failed to parse GitHub API response (jq exit $JQ_EXIT). Response may be malformed."
      exit 1
    fi
    
    LATEST_TAG="$(echo "$JQ_OUTPUT" | extract_latest_dev_tag)"
  else
    echo "[WARN] No GitHub token found (GH_TOKEN/GITHUB_TOKEN variables or gh CLI); attempting unauthenticated registry query"
    
    REGISTRY_RESPONSE="$(curl -sS -w "\n%{http_code}" "https://ghcr.io/v2/$GITHUB_ORG/$GITHUB_PACKAGE/tags/list" 2>&1)"
    CURL_EXIT=$?
    
    if [[ $CURL_EXIT -ne 0 ]]; then
      echo "[ERROR] GHCR registry query failed (exit $CURL_EXIT). Set GH_TOKEN or use --tag to specify explicitly."
      exit 1
    fi
    
    HTTP_CODE="$(echo "$REGISTRY_RESPONSE" | tail -n 1)"
    REGISTRY_BODY="$(echo "$REGISTRY_RESPONSE" | sed '$d')"
    
    if [[ "$HTTP_CODE" != "200" ]]; then
      echo "[ERROR] GHCR registry returned HTTP $HTTP_CODE (likely requires auth). Set GH_TOKEN or use --tag."
      exit 1
    fi
    
    JQ_OUTPUT="$(echo "$REGISTRY_BODY" | jq -r '.tags[]' 2>&1)"
    JQ_EXIT=$?
    if [[ $JQ_EXIT -ne 0 ]]; then
      echo "[ERROR] Failed to parse GHCR registry response (jq exit $JQ_EXIT). Response may be malformed."
      exit 1
    fi
    
    LATEST_TAG="$(echo "$JQ_OUTPUT" | extract_latest_dev_tag)"
  fi

  if [[ -z "$LATEST_TAG" || "$LATEST_TAG" == "null" ]]; then
    echo "[ERROR] Could not determine latest dev version. Use --tag to specify explicitly."
    exit 1
  fi
  
  TARGET_TAG="$LATEST_TAG"
fi

TARGET_IMAGE="$IMAGE_REPO:$TARGET_TAG"
echo "[INFO] Target tag: $TARGET_TAG"
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

echo "[INFO] Retagging image for compose proxy service: $COMPOSE_PROXY_IMAGE"
docker tag "$TARGET_IMAGE" "$COMPOSE_PROXY_IMAGE"

# Build docker compose command with project metadata from container labels
COMPOSE_CMD=(docker compose)
if [[ -n "$COMPOSE_PROJECT" ]]; then
  COMPOSE_CMD+=(-p "$COMPOSE_PROJECT")
fi
if [[ -n "$COMPOSE_CONFIG_FILES" ]]; then
  # Split comma-separated config files and add -f flag for each
  IFS=',' read -ra CONFIG_FILES <<< "$COMPOSE_CONFIG_FILES"
  for config_file in "${CONFIG_FILES[@]}"; do
    COMPOSE_CMD+=(-f "$config_file")
  done
fi

echo "[INFO] Restarting with docker compose..."
if [[ -n "$COMPOSE_WORKING_DIR" && -d "$COMPOSE_WORKING_DIR" ]]; then
  echo "[INFO] Using compose working directory: $COMPOSE_WORKING_DIR"
  cd "$COMPOSE_WORKING_DIR"
fi

"${COMPOSE_CMD[@]}" down
"${COMPOSE_CMD[@]}" up -d

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

#!/usr/bin/env bash
#
# deploy-safe.sh — atomic deploy with automatic rollback on validation failure.
#
# Flow:
#   1. snapshot current :latest as :previous (skip if first deploy)
#   2. pull new :latest, recreate container
#   3. wait + run post-deploy-check.sh; retry once after a short stabilisation
#      window if it fails on the first attempt
#   4. on persistent failure: invoke rollback.sh (only if :previous exists)
#
# Exit codes:
#   0 — deploy validated, healthy
#   1 — validation failed; rollback executed (or skipped if no :previous)
#
# IMPORTANT — env knobs that affect validation:
#   API_KEY — forwarded to post-deploy-check.sh via env inheritance.
#             /api/search and /api/v1/artist/discover require auth unless
#             REQUIRE_API_KEY=false. If you don't set API_KEY, validation
#             will 401 → rollback will fire every run, even on healthy
#             deploys. Set it once in the operator shell.
#
# Safety properties:
#   - never invokes rollback.sh if :previous is missing (first deploy)
#   - never takes the running container down except via rollback.sh's own
#     compose-down/up cycle, which only fires when a previous image exists
#   - on first deploy, a failed validation leaves the broken new container
#     running (no rollback possible) — same outcome as plain
#     `docker compose up -d`, but the exit code is 1 so wrappers can alert

set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BASE_DIR"

echo "========================================"
echo "Melodarr SAFE DEPLOY"
echo "========================================"

IMAGE="ghcr.io/melodarr/melodarr-proxy:latest"
PREVIOUS="ghcr.io/melodarr/melodarr-proxy:previous"

POST_DEPLOY="./scripts/post-deploy-check.sh"
ROLLBACK="./scripts/rollback.sh"

# -----------------------------
# STEP 1 — Snapshot current image
# -----------------------------
echo
echo "[1] Snapshot current image"

if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker tag "$IMAGE" "$PREVIOUS"
  echo "✓ Snapshot created ($PREVIOUS now points at the soon-to-be-old :latest)"
else
  echo "⚠ No existing :latest image found — first deploy. Rollback will be unavailable for this run."
fi

# -----------------------------
# STEP 2 — Deploy new version
# -----------------------------
echo
echo "[2] Deploying new version"

docker compose pull
docker compose up -d

echo "✓ Deployment complete"

# -----------------------------
# STEP 3 — Wait for startup
# -----------------------------
echo
echo "[3] Waiting for service..."

sleep 5

# -----------------------------
# STEP 4 — Validate
# -----------------------------
echo
echo "[4] Running validation"

if "$POST_DEPLOY"; then
  echo
  echo "========================================"
  echo "DEPLOY SUCCESS"
  echo "========================================"
  exit 0
fi

# -----------------------------
# STEP 5 — Retry (stabilization)
# -----------------------------
echo
echo "Initial validation failed, retrying after stabilization window..."

sleep 5

if "$POST_DEPLOY"; then
  echo
  echo "Recovered after retry"
  echo "========================================"
  echo "DEPLOY SUCCESS (after retry)"
  echo "========================================"
  exit 0
fi

# -----------------------------
# STEP 6 — Rollback
# -----------------------------
echo
echo "========================================"
echo "VALIDATION FAILED — ROLLING BACK"
echo "========================================"

if docker image inspect "$PREVIOUS" >/dev/null 2>&1; then
  "$ROLLBACK"
  echo
  echo "Rollback complete"
else
  echo "⚠ No previous image available — cannot rollback."
  echo "  The broken new container is still running. Investigate manually."
fi

exit 1

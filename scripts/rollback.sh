#!/usr/bin/env bash
#
# rollback.sh — restore the previously-running proxy image.
#
# Run from the project root (where docker-compose.yml lives).
#
# IMPORTANT — supporting infrastructure required:
# This script assumes a "previous" image tag exists locally before it
# runs. The current deploy flow does NOT create that tag automatically;
# you need to add a step like
#   docker tag ghcr.io/melodarr/melodarr-proxy:latest \
#              ghcr.io/melodarr/melodarr-proxy:previous
# to the deploy pipeline (BEFORE the new pull) so this script has
# something to roll back to. Without that, this script is inert.
#
# Env knobs:
#   IMAGE      default ghcr.io/melodarr/melodarr-proxy
#   PREV_TAG   default :previous
#   CURR_TAG   default :latest
#   COMPOSE    default 'docker compose'

set -e

IMAGE="${IMAGE:-ghcr.io/melodarr/melodarr-proxy}"
PREV_TAG="${PREV_TAG:-previous}"
CURR_TAG="${CURR_TAG:-latest}"
COMPOSE="${COMPOSE:-docker compose}"

echo "========================================"
echo "Melodarr Rollback"
echo "========================================"
echo "Image:     $IMAGE"
echo "Prev tag:  $PREV_TAG"
echo "Curr tag:  $CURR_TAG"
echo

# Pre-flight: verify the previous tag exists BEFORE bringing the
# service down. Otherwise we'd take the proxy offline and then fail
# on the docker tag step, leaving operators with no service and no
# rollback path.
if ! docker image inspect "$IMAGE:$PREV_TAG" >/dev/null 2>&1; then
  echo "ERROR: $IMAGE:$PREV_TAG not found locally."
  echo "       Aborting BEFORE stopping the container so the service stays up."
  echo
  echo "  Available tags for $IMAGE:"
  docker images --format "  {{.Repository}}:{{.Tag}}" | grep -E "^  $IMAGE:" || echo "  (none)"
  echo
  echo "  Add a tagging step to the deploy flow:"
  echo "    docker tag $IMAGE:$CURR_TAG $IMAGE:$PREV_TAG"
  echo "  BEFORE pulling the new image, so this script has something to restore."
  exit 1
fi

echo "Stopping current container..."
$COMPOSE down

echo "Restoring previous image as :$CURR_TAG..."
docker tag "$IMAGE:$PREV_TAG" "$IMAGE:$CURR_TAG"

echo "Starting service..."
$COMPOSE up -d

echo
echo "========================================"
echo "ROLLBACK COMPLETE"
echo "========================================"
echo "Verify with: scripts/post-deploy-check.sh"

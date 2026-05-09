#!/usr/bin/env bash
set -euo pipefail

# Bypass ~/.docker permission errors by creating a temp config dir
if [ -z "${DOCKER_CONFIG:-}" ] || [ "${DOCKER_CONFIG:-}" = "/tmp" ]; then
  # Use a stable path per process to avoid infinite directories
  export DOCKER_CONFIG="/tmp/melodarr-docker-config"
  if [ ! -d "$DOCKER_CONFIG/cli-plugins" ]; then
    mkdir -p "$DOCKER_CONFIG/cli-plugins"

    # Symlink common plugin locations so we don't lose 'docker compose'
    for d in /Applications/Docker.app/Contents/Resources/cli-plugins /usr/local/lib/docker/cli-plugins /usr/lib/docker/cli-plugins /usr/libexec/docker/cli-plugins /opt/homebrew/lib/docker/cli-plugins; do
      if [ -d "$d" ] && [ -x "$d" ]; then
        ln -sf "$d"/* "$DOCKER_CONFIG/cli-plugins/" 2>/dev/null || true
      fi
    done

    # Also try to find plugins relative to the docker binary
    DOCKER_BIN=$(command -v docker || true)
    if [ -n "$DOCKER_BIN" ]; then
      DOCKER_DIR=$(dirname "$DOCKER_BIN")
      if [ -d "$DOCKER_DIR/../cli-plugins" ] && [ -x "$DOCKER_DIR/../cli-plugins" ]; then
        ln -sf "$DOCKER_DIR/../cli-plugins"/* "$DOCKER_CONFIG/cli-plugins/" 2>/dev/null || true
      fi
      if [ -d "$DOCKER_DIR/../lib/docker/cli-plugins" ] && [ -x "$DOCKER_DIR/../lib/docker/cli-plugins" ]; then
        ln -sf "$DOCKER_DIR/../lib/docker/cli-plugins"/* "$DOCKER_CONFIG/cli-plugins/" 2>/dev/null || true
      fi
    fi
  fi
fi

if docker compose version >/dev/null 2>&1; then
  docker compose "$@"
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose "$@"
else
  echo "docker compose is required, but neither 'docker compose' nor 'docker-compose' is available." >&2
  exit 127
fi

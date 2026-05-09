#!/usr/bin/env bash
set -euo pipefail

if docker compose version >/dev/null 2>&1; then
  DOCKER_CONFIG="${DOCKER_CONFIG:-/tmp}" docker compose "$@"
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_CONFIG="${DOCKER_CONFIG:-/tmp}" docker-compose "$@"
else
  echo "docker compose is required, but neither 'docker compose' nor 'docker-compose' is available." >&2
  exit 127
fi

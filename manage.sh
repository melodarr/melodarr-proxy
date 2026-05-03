#!/usr/bin/env bash

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR" || exit 1

HOST_PORT="${HOST_PORT:-3055}"
MELODASH_HOST_PORT="${MELODASH_HOST_PORT:-55026}"
USE_IPV6_NETWORK="${USE_IPV6_NETWORK:-0}"
DOCKER_NETWORK="${DOCKER_NETWORK:-melodarr-ipv6}"
DOCKER_IPV6_SUBNET="${DOCKER_IPV6_SUBNET:-fd00:dead:beef:1::/64}"

use_ipv6_network() {
  [[ "$USE_IPV6_NETWORK" == "1" || "$USE_IPV6_NETWORK" == "true" || "$USE_IPV6_NETWORK" == "yes" ]]
}

compose_cmd() {
  local compose_files=(-f docker-compose.yml)
  if use_ipv6_network; then
    compose_files+=(-f docker-compose.ipv6.yml)
  fi

  HOST_PORT="$HOST_PORT" MELODASH_HOST_PORT="$MELODASH_HOST_PORT" DOCKER_NETWORK="$DOCKER_NETWORK" docker compose "${compose_files[@]}" "$@"
}

run_proxy_lint() {
  echo "Running proxy lint inside a container..."
  compose_cmd --profile test build test
  compose_cmd --profile test run --rm --no-deps test yarn lint
}

run_proxy_tests() {
  echo "Running proxy tests inside a container..."
  compose_cmd --profile test build test
  compose_cmd --profile test run --rm --no-deps test yarn test
}

run_melodash_lint() {
  echo "Running Melodash typecheck inside a container..."
  compose_cmd --profile test build melodash-test
  compose_cmd --profile test run --rm --no-deps melodash-test yarn lint
}

run_all_checks() {
  run_proxy_lint && run_proxy_tests && run_melodash_lint
}

run_compose_smoke() {
  echo "Running Docker Compose smoke test..."
  HOST_PORT="$HOST_PORT" MELODASH_HOST_PORT="$MELODASH_HOST_PORT" "$ROOT_DIR/scripts/docker-compose-smoke.sh"
}

ensure_network() {
  if ! use_ipv6_network; then
    return
  fi

  if docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1; then
    return
  fi

  echo "Creating Docker IPv6 network ${DOCKER_NETWORK} (${DOCKER_IPV6_SUBNET})..."
  docker network create --ipv6 --subnet "$DOCKER_IPV6_SUBNET" "$DOCKER_NETWORK" >/dev/null
}

pause() {
  printf "\nPress Enter to continue..."
  read -r _
}

mapped_url() {
  local service="$1"
  local port="$2"
  local mapped

  mapped="$(compose_cmd port "$service" "$port" 2>/dev/null | head -n 1 | awk -F: '{print $NF}')"
  if [[ -n "$mapped" ]]; then
    printf "http://localhost:%s" "$mapped"
  else
    printf "(stopped)"
  fi
}

show_menu() {
  clear

  local proxy_url
  local melodash_url
  proxy_url="$(mapped_url proxy 3000)"
  melodash_url="$(mapped_url melodash 3000)"

  cat <<MENU
=====================================================
  Melodarr Proxy - Management Menu
=====================================================
Active Endpoints:
  Proxy API: ${proxy_url}
  Melodash:   ${melodash_url}
=====================================================
1) Start services
2) Stop services
3) Restart running services
4) Rebuild + start services
5) View status
6) View logs
7) Clean up all containers, volumes, and images
8) Run proxy lint in container
9) Run proxy tests in container
10) Run Melodash typecheck in container
11) Run all checks in containers
12) Run proxy diagnostics
13) Run Docker Compose smoke test
0) Exit
=====================================================
MENU
  printf "Select an option [0-13]: "
}

while true; do
  show_menu
  read -r choice

  case "$choice" in
    1)
      echo "Starting proxy, Redis, and Melodash..."
      ensure_network
      compose_cmd up -d --remove-orphans proxy redis melodash
      pause
      ;;
    2)
      echo "Stopping services..."
      compose_cmd down --remove-orphans
      pause
      ;;
    3)
      echo "Restarting running services..."
      compose_cmd restart
      pause
      ;;
    4)
      echo "Rebuilding proxy, Redis, and Melodash..."
      echo "Syncing local package.json version with latest git tag..."
      VERSION=$(git tag --sort=-v:refname | head -n 1 | sed 's/^v//')
      
      if [ -z "$VERSION" ]; then
        echo "ERROR: No git tags found. Cannot determine version."
        exit 1
      fi
      
      npm version --no-git-tag-version "$VERSION"
      compose_cmd down --remove-orphans
      ensure_network
      compose_cmd up -d --build --remove-orphans proxy redis melodash
      pause
      ;;
    5)
      echo "Current container status:"
      echo "-----------------------------------------------------"
      compose_cmd ps
      echo "-----------------------------------------------------"
      pause
      ;;
    6)
      echo "Live logs. Press Ctrl+C to return to the shell."
      compose_cmd logs -f
      pause
      ;;
    7)
      echo "This removes containers, named volumes, and images for this compose project."
      printf "Type DELETE to continue: "
      read -r confirm
      if [[ "$confirm" == "DELETE" ]]; then
        compose_cmd down -v --rmi all --remove-orphans
        if use_ipv6_network; then
          docker network rm "$DOCKER_NETWORK" >/dev/null 2>&1 || true
        fi
        echo "Cleanup complete."
      else
        echo "Cleanup cancelled."
      fi
      pause
      ;;
    8)
      ensure_network
      run_proxy_lint
      pause
      ;;
    9)
      ensure_network
      run_proxy_tests
      pause
      ;;
    10)
      ensure_network
      run_melodash_lint
      pause
      ;;
    11)
      ensure_network
      run_all_checks
      pause
      ;;
    12)
      "$ROOT_DIR/scripts/proxy-diag.sh" all || true
      pause
      ;;
    13)
      run_compose_smoke
      pause
      ;;
    0|"")
      echo "Exiting."
      exit 0
      ;;
    *)
      echo "Invalid option."
      pause
      ;;
  esac
done

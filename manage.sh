#!/usr/bin/env bash

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR" || exit 1

HOST_PORT="${HOST_PORT:-3055}"
MELODASH_HOST_PORT="${MELODASH_HOST_PORT:-55026}"
USE_IPV6_NETWORK="${USE_IPV6_NETWORK:-1}"
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

  HOST_PORT="$HOST_PORT" MELODASH_HOST_PORT="$MELODASH_HOST_PORT" DOCKER_NETWORK="$DOCKER_NETWORK" DOCKER_IPV6_SUBNET="$DOCKER_IPV6_SUBNET" bash scripts/docker-compose-run.sh "${compose_files[@]}" "$@"
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

run_skyhook_contract_check() {
  echo "Running source-derived SkyHook contract tests inside a container..."
  compose_cmd --profile test build test
  compose_cmd --profile test run --rm --no-deps test yarn test:contracts

  echo "Running live /api/v1/artist/lookup SkyHook contract smoke test..."
  ensure_network
  REQUIRE_API_KEY=false compose_cmd up -d --remove-orphans proxy redis

  local proxy_port
  local proxy_url
  proxy_port="$(compose_cmd port proxy 3000 2>/dev/null | head -n 1 | awk -F: '{print $NF}')"
  proxy_url="http://127.0.0.1:${proxy_port:-$HOST_PORT}"

  for _ in {1..20}; do
    if node -e "fetch(process.argv[1]).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" "$proxy_url/api/health"; then
      break
    fi
    sleep 2
  done

  node -e '
const url = process.argv[1]
const required = ["foreignArtistId", "status", "links", "aliases"]

fetch(url)
  .then(async response => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return response.json()
  })
  .then(body => {
    if (!Array.isArray(body)) {
      throw new Error("expected lookup response to be an array")
    }
    if (body.length === 0) {
      console.log("SkyHook lookup contract passed: empty lookup response accepted")
      return
    }
    const artist = body[0] || {}
    const missing = required.filter(key => !Object.prototype.hasOwnProperty.call(artist, key))
    if (missing.length > 0) {
      throw new Error(`missing required lookup fields: ${missing.join(", ")}`)
    }
    console.log(`SkyHook lookup contract passed: ${required.join(", ")}`)
  })
  .catch(error => {
    console.error(`SkyHook lookup contract failed: ${error.message}`)
    process.exit(1)
  })
' "$proxy_url/api/v1/artist/lookup?term=Radiohead"
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
  if ! docker network create --ipv6 --subnet "$DOCKER_IPV6_SUBNET" "$DOCKER_NETWORK" >/dev/null; then
    echo "ERROR: unable to create IPv6 Docker network ${DOCKER_NETWORK}."
    echo "Run scripts/ensure-docker-ipv6.sh as root on the Docker host/LXC, then retry."
    exit 1
  fi
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
14) Run SkyHook contract validation
0) Exit
=====================================================
MENU
  printf "Select an option [0-14]: "
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
      
      npm version --no-git-tag-version --allow-same-version "$VERSION"
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
    14)
      ensure_network
      run_skyhook_contract_check
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

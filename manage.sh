#!/usr/bin/env bash

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR" || exit 1

HOST_PORT="${HOST_PORT:-3055}"
DOCKER_NETWORK="${DOCKER_NETWORK:-melodarr-ipv6}"
DOCKER_IPV6_SUBNET="${DOCKER_IPV6_SUBNET:-fd00:dead:beef:1::/64}"

compose_cmd() {
  HOST_PORT="$HOST_PORT" docker compose "$@"
}


ensure_network() {
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
  proxy_url="$(mapped_url proxy 3000)"

  cat <<MENU
=====================================================
  Melodarr Proxy - Management Menu
=====================================================
Active Endpoints:
  Proxy:    ${proxy_url}
=====================================================
1) Start services
2) Stop services
3) Restart running services
4) Rebuild + start services
5) View status
6) View logs
7) Clean up all containers, volumes, and images
0) Exit
=====================================================
MENU
  printf "Select an option [0-9]: "
}

while true; do
  show_menu
  read -r choice

  case "$choice" in
    1)
      echo "Starting proxy and Redis on http://localhost:${HOST_PORT}..."
      ensure_network
      compose_cmd up -d proxy redis
      pause
      ;;
    2)
      echo "Stopping services..."
      compose_cmd down
      pause
      ;;
    3)
      echo "Restarting running services..."
      compose_cmd restart
      pause
      ;;
    4)
      echo "Rebuilding proxy and starting Redis..."
      ensure_network
      compose_cmd up -d --build proxy redis
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
        docker network rm "$DOCKER_NETWORK" >/dev/null 2>&1 || true
        echo "Cleanup complete."
      else
        echo "Cleanup cancelled."
      fi
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

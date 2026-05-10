#!/usr/bin/env bash
# Idempotently enable Docker IPv6 for Melodarr source and LXC deployments.
#
# Run on the Docker host or inside the Proxmox LXC that runs Docker:
#   sudo ./scripts/ensure-docker-ipv6.sh

set -euo pipefail

DOCKER_FIXED_CIDR_V6="${DOCKER_FIXED_CIDR_V6:-fd00:dead:beef::/64}"
DOCKER_NETWORK="${DOCKER_NETWORK:-melodarr-ipv6}"
DOCKER_NETWORK_IPV6_SUBNET="${DOCKER_NETWORK_IPV6_SUBNET:-${DOCKER_IPV6_SUBNET:-fd00:dead:beef:1::/64}}"
DAEMON_JSON="${DAEMON_JSON:-/etc/docker/daemon.json}"
RESTART_DOCKER="${RESTART_DOCKER:-1}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: run as root on the Docker host/LXC." >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed or not on PATH." >&2
  exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required to safely merge ${DAEMON_JSON}." >&2
  exit 2
fi

echo "Enabling IPv6 forwarding..."
cat > /etc/sysctl.d/99-melodarr-ipv6-forwarding.conf <<SYSCTL
net.ipv6.conf.all.forwarding=1
net.ipv6.conf.default.forwarding=1
SYSCTL
sysctl --system >/dev/null

mkdir -p "$(dirname "$DAEMON_JSON")"
if [[ -f "$DAEMON_JSON" ]]; then
  cp "$DAEMON_JSON" "${DAEMON_JSON}.bak.$(date +%s)"
else
  printf '{}\n' > "$DAEMON_JSON"
fi

echo "Configuring Docker daemon IPv6 (${DOCKER_FIXED_CIDR_V6})..."
DAEMON_JSON="$DAEMON_JSON" DOCKER_FIXED_CIDR_V6="$DOCKER_FIXED_CIDR_V6" python3 <<'PY'
import json
import os
from pathlib import Path

path = Path(os.environ["DAEMON_JSON"])
try:
    data = json.loads(path.read_text() or "{}")
except json.JSONDecodeError as exc:
    raise SystemExit(f"ERROR: {path} is not valid JSON: {exc}")

data["ipv6"] = True
data["fixed-cidr-v6"] = os.environ["DOCKER_FIXED_CIDR_V6"]
data["ip6tables"] = True
data["experimental"] = True
path.write_text(json.dumps(data, indent=2) + "\n")
PY

if [[ "$RESTART_DOCKER" == "1" || "$RESTART_DOCKER" == "true" ]]; then
  echo "Restarting Docker..."
  systemctl restart docker
fi

if docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1; then
  if docker network inspect "$DOCKER_NETWORK" | grep -q '"EnableIPv6": true'; then
    echo "Docker network ${DOCKER_NETWORK} already has IPv6 enabled."
  else
    echo "ERROR: Docker network ${DOCKER_NETWORK} exists but IPv6 is disabled." >&2
    echo "Remove/recreate it during a maintenance window:" >&2
    echo "  docker network rm ${DOCKER_NETWORK}" >&2
    echo "  docker network create --ipv6 --subnet ${DOCKER_NETWORK_IPV6_SUBNET} ${DOCKER_NETWORK}" >&2
    exit 1
  fi
else
  echo "Creating Docker IPv6 network ${DOCKER_NETWORK} (${DOCKER_NETWORK_IPV6_SUBNET})..."
  docker network create --ipv6 --subnet "$DOCKER_NETWORK_IPV6_SUBNET" "$DOCKER_NETWORK" >/dev/null
fi

echo "Docker IPv6 is configured."
echo "Next: recreate Melodarr containers so they attach to the IPv6 network:"
echo "  docker compose -f docker-compose.yml -f docker-compose.ipv6.yml up -d --force-recreate"

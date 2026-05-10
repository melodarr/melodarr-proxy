#!/usr/bin/env bash
set -euo pipefail

DOCKER_NETWORK="${DOCKER_NETWORK:-melodarr-ipv6}"

if docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1; then
  echo "OK Docker IPv6 network exists: ${DOCKER_NETWORK}"
  exit 0
fi

declare -a candidates=()

if [[ -n "${DOCKER_IPV6_SUBNET:-}" ]]; then
  candidates+=("$DOCKER_IPV6_SUBNET")
fi

candidates+=(
  "fd00:4d45:4c4f:1::/64"
  "fd00:4d45:4c4f:2::/64"
  "fd00:4d45:4c4f:3::/64"
  "fd00:4d45:4c4f:4::/64"
  "fd00:4d45:4c4f:5::/64"
  "fd00:dead:beef:1::/64"
)

for subnet in "${candidates[@]}"; do
  if docker network create --ipv6 --subnet "$subnet" "$DOCKER_NETWORK" >/dev/null 2>&1; then
    echo "OK Docker IPv6 network created: ${DOCKER_NETWORK} (${subnet})"
    exit 0
  fi
done

echo "FAIL Docker IPv6 network: unable to create ${DOCKER_NETWORK}" >&2
echo "Tried subnets:" >&2
printf '  %s\n' "${candidates[@]}" >&2
echo "Existing Docker networks:" >&2
docker network ls >&2 || true
echo "Run scripts/ensure-docker-ipv6.sh as root on the Docker host/LXC, then retry." >&2
exit 1

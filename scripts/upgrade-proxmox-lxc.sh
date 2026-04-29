#!/usr/bin/env bash
set -euo pipefail

CTID="${1:-${CTID:-}}"

if [[ -z "$CTID" ]]; then
  echo "Usage: $0 <CTID>"
  echo "Or set the CTID environment variable: CTID=163 $0"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root on the Proxmox host."
  exit 1
fi

if ! command -v pct >/dev/null 2>&1; then
  echo "pct command not found. This must be run on a Proxmox host."
  exit 1
fi

if ! pct status "$CTID" >/dev/null 2>&1; then
  echo "Container ID $CTID does not exist."
  exit 1
fi

STATUS=$(pct status "$CTID" | awk '{print $2}')
if [[ "$STATUS" != "running" ]]; then
  echo "Container $CTID is not running. Starting it now..."
  pct start "$CTID"
  sleep 5
fi

echo "=========================================================="
echo "Upgrading Melodarr Proxy in LXC Container: $CTID"
echo "=========================================================="

COMPOSE_FILE="/opt/melodarr-proxy/compose.yml"

# Check if docker compose exists in the container
if ! pct exec "$CTID" -- bash -c "test -f $COMPOSE_FILE"; then
  echo "Error: $COMPOSE_FILE not found in container $CTID."
  echo "Is this a valid Melodarr Proxy container?"
  exit 1
fi

echo "Checking installation type..."
IS_SOURCE_BUILD=$(pct exec "$CTID" -- grep -c "image: melodarr-proxy:local" "$COMPOSE_FILE" || true)
HAS_DEVDASH=$(pct exec "$CTID" -- bash -c "cd /opt/melodarr-proxy && docker compose config --services | grep -cx devdash" || true)

if [[ "$HAS_DEVDASH" -eq 0 ]]; then
  echo "DevDash service missing from compose.yml. Adding it now..."
  pct exec "$CTID" -- bash -c "awk '
    /^volumes:/ && !inserted {
      print \"\"
      print \"  devdash:\"
      print \"    image: ghcr.io/melodarr/melodarr-proxy-devdash:latest\"
      print \"    restart: unless-stopped\"
      print \"    environment:\"
      print \"      PORT: 3000\"
      print \"      PROXY_API_URL: http://proxy:3000/api\"
      print \"    ports:\"
      print \"      - \\\"55026:3000\\\"\"
      print \"    depends_on:\"
      print \"      - proxy\"
      inserted = 1
    }
    { print }
  ' $COMPOSE_FILE > /tmp/melodarr-compose.yml && mv /tmp/melodarr-compose.yml $COMPOSE_FILE"
fi

if [[ "$IS_SOURCE_BUILD" -gt 0 ]]; then
  echo "Detected SOURCE BUILD fallback installation."
  echo "Pulling latest code from git..."
  pct exec "$CTID" -- bash -c "cd /opt/melodarr-proxy/src && git fetch --all && git reset --hard origin/main && git pull"
  
  echo "Building new local image..."
  pct exec "$CTID" -- bash -c "cd /opt/melodarr-proxy && docker build -t melodarr-proxy:local --target production src/"
else
  echo "Detected STANDARD IMAGE installation."
  echo "Pulling latest Docker images..."
  pct exec "$CTID" -- bash -c "cd /opt/melodarr-proxy && docker compose pull proxy devdash"
fi

echo "Recreating and restarting containers..."
pct exec "$CTID" -- bash -c "cd /opt/melodarr-proxy && docker compose up -d proxy redis devdash"

echo "Cleaning up dangling images to save space..."
pct exec "$CTID" -- docker image prune -f

echo "=========================================================="
echo "Upgrade Complete!"
echo "Verify status with:"
echo "  pct exec $CTID -- docker ps"
echo "  pct exec $CTID -- curl -s http://127.0.0.1:3055/api/health"
echo "  open http://<lxc-ip>:55026/dashboard"
echo "=========================================================="

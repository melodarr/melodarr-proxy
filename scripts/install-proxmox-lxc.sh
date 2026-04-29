#!/usr/bin/env bash
set -euo pipefail

### ===== USER SETTINGS =====
CTID="${CTID:-}"
HOSTNAME="${HOSTNAME:-melodarr-proxy}"
PASSWORD="${PASSWORD:-ChangeThisNow123!}"
STORAGE="${STORAGE:-local-lvm}"
DISK_SIZE="${DISK_SIZE:-8}"
CORES="${CORES:-1}"
MEMORY="${MEMORY:-1024}"
SWAP="${SWAP:-512}"
BRIDGE="${BRIDGE:-vmbr0}"
IPADDR="${IPADDR:-dhcp}" # Example static: 172.16.0.240/16
GATEWAY="${GATEWAY:-}" # Example static gateway: 172.16.0.1
DNS="${DNS:-1.1.1.1 8.8.8.8}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
TEMPLATE_FILE="${TEMPLATE_FILE:-debian-12-standard_12.12-1_amd64.tar.zst}"
UNPRIVILEGED="${UNPRIVILEGED:-1}"

HOST_PORT="${HOST_PORT:-3055}"
MELODASH_HOST_PORT="${MELODASH_HOST_PORT:-55026}"
APP_CONTACT="${APP_CONTACT:-admin@example.com}"
APP_VERSION="${APP_VERSION:-latest}"
IMAGE="${IMAGE:-ghcr.io/melodarr/melodarr-proxy:${APP_VERSION}}"
MELODASH_IMAGE="${MELODASH_IMAGE:-ghcr.io/melodarr/melodarr-proxy-melodash:${APP_VERSION}}"
REPO_URL="${REPO_URL:-https://github.com/melodarr/melodarr-proxy.git}"
ALLOW_SOURCE_FALLBACK="${ALLOW_SOURCE_FALLBACK:-false}"

# Optional GitHub Container Registry auth if the image is private
GHCR_USER="${GHCR_USER:-}"
GHCR_TOKEN="${GHCR_TOKEN:-}"
### =========================

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root on the Proxmox host."
  exit 1
fi

if ! command -v pct >/dev/null 2>&1; then
  echo "pct command not found. This must be run on a Proxmox host."
  exit 1
fi

if ! command -v pvesh >/dev/null 2>&1; then
  echo "pvesh command not found. This must be run on a Proxmox host."
  exit 1
fi

if ! command -v pveam >/dev/null 2>&1; then
  echo "pveam command not found. This must be run on a Proxmox host."
  exit 1
fi

if [[ -z "$CTID" ]]; then
  CTID="$(pvesh get /cluster/nextid)"
fi

if pct status "$CTID" >/dev/null 2>&1; then
  echo "Container ID $CTID already exists."
  exit 1
fi

TEMPLATE_PATH=""

list_local_templates () {
  pveam list "$TEMPLATE_STORAGE" 2>/dev/null \
    | awk 'NR>1 {print $1}' \
    | sed "s|^${TEMPLATE_STORAGE}:vztmpl/||"
}

list_available_templates () {
  pveam available --section system 2>/dev/null | awk 'NR>1 {print $2}'
}

prompt_select () {
  local prompt="$1"; shift
  local options=("$@")

  if [[ ! -t 0 ]]; then
    echo "stdin is not a TTY; cannot prompt for template selection." >&2
    echo "Set TEMPLATE_FILE explicitly to run unattended." >&2
    exit 1
  fi

  echo "$prompt" >&2
  local i=1
  for opt in "${options[@]}"; do
    printf "  %2d) %s\n" "$i" "$opt" >&2
    i=$((i + 1))
  done

  local choice
  while true; do
    read -rp "Enter number [1-${#options[@]}]: " choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#options[@]} )); then
      echo "${options[choice - 1]}"
      return
    fi
    echo "Invalid selection." >&2
  done
}

resolve_template () {
  if [[ -n "${TEMPLATE_FILE:-}" ]]; then
    local explicit_path="/var/lib/vz/template/cache/$TEMPLATE_FILE"
    if [[ -f "$explicit_path" ]]; then
      TEMPLATE_PATH="$explicit_path"
      return
    fi
    echo "Configured TEMPLATE_FILE not found locally: $TEMPLATE_FILE" >&2
    echo "Falling back to interactive selection..." >&2
  fi

  mapfile -t local_templates < <(list_local_templates)

  if [[ ${#local_templates[@]} -gt 0 ]]; then
    local picked
    if [[ ${#local_templates[@]} -eq 1 ]]; then
      picked="${local_templates[0]}"
      echo "Using only available template on '$TEMPLATE_STORAGE': $picked"
    else
      picked="$(prompt_select "Templates available on '$TEMPLATE_STORAGE':" "${local_templates[@]}")"
    fi
    TEMPLATE_FILE="$picked"
    TEMPLATE_PATH="/var/lib/vz/template/cache/$picked"
    return
  fi

  echo "No templates found on '$TEMPLATE_STORAGE'."
  echo "Refreshing the template index..."
  pveam update >/dev/null 2>&1 || true

  mapfile -t available_templates < <(list_available_templates)
  if [[ ${#available_templates[@]} -eq 0 ]]; then
    echo "No templates returned by 'pveam available'. Check network/DNS." >&2
    exit 1
  fi

  local picked
  picked="$(prompt_select "Select a template to download to '$TEMPLATE_STORAGE':" "${available_templates[@]}")"

  echo "Downloading $picked..."
  pveam download "$TEMPLATE_STORAGE" "$picked"

  TEMPLATE_FILE="$picked"
  TEMPLATE_PATH="/var/lib/vz/template/cache/$picked"
}

resolve_template

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "Template still not present at $TEMPLATE_PATH after selection." >&2
  exit 1
fi

echo "Using template: $TEMPLATE_FILE"

NET0="name=eth0,bridge=${BRIDGE},ip=${IPADDR}"
if [[ -n "$GATEWAY" && "$IPADDR" != "dhcp" ]]; then
  NET0="${NET0},gw=${GATEWAY}"
fi

echo "Creating LXC $CTID ($HOSTNAME)..."

pct create "$CTID" "$TEMPLATE_PATH" \
  --hostname "$HOSTNAME" \
  --password "$PASSWORD" \
  --unprivileged "$UNPRIVILEGED" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --swap "$SWAP" \
  --rootfs "${STORAGE}:${DISK_SIZE}" \
  --net0 "$NET0" \
  --nameserver "$DNS" \
  --features nesting=1,keyctl=1 \
  --onboot 1 \
  --ostype debian

echo "Setting useful container options..."
pct set "$CTID" -tags melodarr-proxy,docker,music

echo "Starting container..."
pct start "$CTID"

echo "Waiting a few seconds for boot..."
sleep 8

BOOTSTRAP_SCRIPT="/tmp/melodarr-proxy-bootstrap.sh"

cat > "$BOOTSTRAP_SCRIPT" <<EOF
#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export LC_ALL=C
export LANG=C

apt-get update
apt-get install -y ca-certificates curl

install -m 0755 -d /etc/apt/keyrings

if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi

ARCH="\$(dpkg --print-architecture)"
CODENAME="\$(. /etc/os-release && echo "\$VERSION_CODENAME")"

echo "deb [arch=\${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \${CODENAME} stable" \\
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker

if [[ -n "${GHCR_USER}" ]] && [[ -n "${GHCR_TOKEN}" ]]; then
  echo "Authenticating with GHCR as ${GHCR_USER}..."
  echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin
fi

mkdir -p /opt/melodarr-proxy

cat > /opt/melodarr-proxy/compose.yml <<COMPOSE
services:
  proxy:
    image: ${IMAGE}
    restart: unless-stopped
    environment:
      PORT: 3000
      REDIS_URL: redis://redis:6379
      DATA_DIR: /data
      APP_NAME: melodarr-proxy
      APP_VERSION: ${APP_VERSION}
      APP_CONTACT: ${APP_CONTACT}
      METADATA_PROVIDERS: musicbrainz,itunes
      PROVIDER_PRIORITY: musicbrainz,theaudiodb,itunes,lastfm,discogs
      MUSICBRAINZ_BASE_URL: https://musicbrainz.org/ws/2
      MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS: 1100
      CACHE_TTL_SECONDS: 86400
      UPSTREAM_TIMEOUT_MS: 8000
      SLOW_REQUEST_MS: 2000
      NODE_OPTIONS: --dns-result-order=ipv4first
    ports:
      - "${HOST_PORT}:3000"
    volumes:
      - melodarr_proxy_data:/data
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--save", "", "--appendonly", "no"]

  melodash:
    image: ${MELODASH_IMAGE}
    restart: unless-stopped
    environment:
      PORT: 3000
      PROXY_API_URL: http://proxy:3000/api
    ports:
      - "${MELODASH_HOST_PORT}:3000"
    depends_on:
      - proxy

volumes:
  melodarr_proxy_data:
COMPOSE

cd /opt/melodarr-proxy
if ! docker compose pull proxy melodash > /tmp/pull.log 2>&1; then
  echo
  echo "Failed to pull image ${IMAGE} or ${MELODASH_IMAGE}."
  
  PULL_OUTPUT=\$(cat /tmp/pull.log)
  if echo "\$PULL_OUTPUT" | grep -qi "unauthorized"; then
    echo "Reason: Unauthorized. This usually means the image is private or credentials are required."
  elif echo "\$PULL_OUTPUT" | grep -qi "manifest unknown"; then
    echo "Reason: Version ${APP_VERSION} not found (manifest unknown)."
  else
    echo "Reason: Network error or registry unreachable."
    echo "Details: \$PULL_OUTPUT"
  fi

  if [[ "${ALLOW_SOURCE_FALLBACK}" != "true" ]]; then
    echo "=========================================================="
    echo "ERROR: Docker pull failed and ALLOW_SOURCE_FALLBACK is false."
    echo "Set ALLOW_SOURCE_FALLBACK=true to build from source."
    echo "=========================================================="
    exit 1
  fi

  echo
  echo "ALLOW_SOURCE_FALLBACK is enabled. Attempting to clone and build from source (${REPO_URL})..."
  echo "=========================================================="
  echo "WARNING: Building from source. This image may differ from the official pre-built image."
  echo "=========================================================="
  echo
  
  if docker image inspect melodarr-proxy:local >/dev/null 2>&1; then
    echo "Found existing local build: melodarr-proxy:local. Reusing it."
  else
    apt-get update
    apt-get install -y git
    
    if [[ ! -d "src" ]]; then
      if ! git clone "${REPO_URL}" src; then
        echo "=========================================================="
        echo "ERROR: Failed to clone repository."
        echo "The repository might be private or not exist yet."
        echo "=========================================================="
        exit 1
      fi
    fi
    
    echo "Building melodarr-proxy:local..."
    if ! docker build -t melodarr-proxy:local --target production src/; then
      echo "=========================================================="
      echo "ERROR: Docker failed to build the image."
      echo "=========================================================="
      exit 1
    fi
  fi
  
  # Replace the compose file to build from source
  cat > /opt/melodarr-proxy/compose.yml <<SOURCE_COMPOSE
services:
  proxy:
    image: melodarr-proxy:local
    restart: unless-stopped
    environment:
      PORT: 3000
      REDIS_URL: redis://redis:6379
      DATA_DIR: /data
      APP_NAME: melodarr-proxy
      APP_VERSION: ${APP_VERSION}
      APP_CONTACT: ${APP_CONTACT}
      METADATA_PROVIDERS: musicbrainz,itunes
      PROVIDER_PRIORITY: musicbrainz,theaudiodb,itunes,lastfm,discogs
      MUSICBRAINZ_BASE_URL: https://musicbrainz.org/ws/2
      MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS: 1100
      CACHE_TTL_SECONDS: 86400
      UPSTREAM_TIMEOUT_MS: 8000
      SLOW_REQUEST_MS: 2000
      NODE_OPTIONS: --dns-result-order=ipv4first
    ports:
      - "${HOST_PORT}:3000"
    volumes:
      - melodarr_proxy_data:/data
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--save", "", "--appendonly", "no"]

  melodash:
    build:
      context: ./melodash
    restart: unless-stopped
    environment:
      PORT: 3000
      PROXY_API_URL: http://proxy:3000/api
    ports:
      - "${MELODASH_HOST_PORT}:3000"
    depends_on:
      - proxy

volumes:
  melodarr_proxy_data:
SOURCE_COMPOSE

fi

if ! docker compose up -d; then
  echo "=========================================================="
  echo "ERROR: Docker failed to start the containers."
  echo "=========================================================="
  exit 1
fi

echo
echo "Melodarr Proxy installed."
echo "Test locally with:"
echo "  curl http://127.0.0.1:${HOST_PORT}/api/health"
echo "Open Melodash at:"
echo "  http://<container-ip>:${MELODASH_HOST_PORT}/dashboard"
EOF

chmod +x "$BOOTSTRAP_SCRIPT"

echo "Pushing bootstrap script into container..."
pct push "$CTID" "$BOOTSTRAP_SCRIPT" /root/melodarr-proxy-bootstrap.sh -perms 755

echo "Running bootstrap inside container..."
if ! pct exec "$CTID" -- bash /root/melodarr-proxy-bootstrap.sh; then
  echo "Bootstrap script failed. Container $CTID has been created but setup is incomplete."
  exit 1
fi

echo
echo "Done."
echo "Container ID: $CTID"
echo "Hostname:     $HOSTNAME"
echo "Port:         $HOST_PORT"
echo
echo "Check status:"
echo "  pct exec $CTID -- docker ps"
echo "  pct exec $CTID -- curl http://127.0.0.1:${HOST_PORT}/api/health"
echo
echo "If using DHCP, get the IP with:"
echo "  pct exec $CTID -- hostname -I"
echo
echo "Then open:"
echo "  http://<container-ip>:${HOST_PORT}"
echo
echo "=========================================================="
echo "Creating Upgrade Script..."
echo "=========================================================="
UPGRADE_SCRIPT="upgrade-melodarr-proxy-${CTID}.sh"
cat > "$UPGRADE_SCRIPT" <<'EOF_UPGRADE'
#!/usr/bin/env bash
set -euo pipefail

CTID="%%CTID%%"

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root on the Proxmox host."
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

if ! pct exec "$CTID" -- bash -c "test -f $COMPOSE_FILE"; then
  echo "Error: $COMPOSE_FILE not found in container $CTID."
  exit 1
fi

IS_SOURCE_BUILD=$(pct exec "$CTID" -- grep -c "image: melodarr-proxy:local" "$COMPOSE_FILE" || true)

if pct exec "$CTID" -- grep -q "devdash\|melodarr-proxy-devdash\|DEVDASH" "$COMPOSE_FILE"; then
  echo "Renaming legacy DevDash compose entries to Melodash..."
  pct exec "$CTID" -- sed -i \
    -e 's/devdash/melodash/g' \
    -e 's/DevDash/Melodash/g' \
    -e 's/DEVDASH/MELODASH/g' \
    -e 's/melodarr-proxy-devdash/melodarr-proxy-melodash/g' \
    -e 's#src/devdash#melodash#g' \
    -e 's#\./devdash#\./melodash#g' \
    "$COMPOSE_FILE"
fi

HAS_MELODASH=$(pct exec "$CTID" -- bash -c "cd /opt/melodarr-proxy && docker compose config --services | grep -cx melodash" || true)

if [[ "$HAS_MELODASH" -eq 0 ]]; then
  echo "Melodash service missing from compose.yml. Adding it now..."
  pct exec "$CTID" -- bash -c "awk '
    /^volumes:/ && !inserted {
      print \"\"
      print \"  melodash:\"
      print \"    image: ghcr.io/melodarr/melodarr-proxy-melodash:latest\"
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
  echo "Pulling latest Docker image..."
  pct exec "$CTID" -- bash -c "cd /opt/melodarr-proxy && docker compose pull proxy melodash"
fi

echo "Recreating and restarting containers..."
pct exec "$CTID" -- bash -c "cd /opt/melodarr-proxy && docker compose up -d proxy redis melodash"

echo "Cleaning up dangling images to save space..."
pct exec "$CTID" -- docker image prune -f

echo "=========================================================="
echo "Upgrade Complete!"
echo "=========================================================="
EOF_UPGRADE

sed -i "s/%%CTID%%/${CTID}/g" "$UPGRADE_SCRIPT"
chmod +x "$UPGRADE_SCRIPT"

echo "An upgrade script has been created for this container: ./$UPGRADE_SCRIPT"
echo "You can run it anytime to pull the latest version and update the proxy."

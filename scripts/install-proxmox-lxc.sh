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
APP_CONTACT="${APP_CONTACT:-admin@example.com}"
IMAGE="${IMAGE:-ghcr.io/melodarr/melodarr-proxy:v0.1.1}"
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

apt-get update
apt-get install -y \\
  ca-certificates \\
  curl \\
  gnupg \\
  lsb-release \\
  apt-transport-https \\
  software-properties-common

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
      APP_VERSION: 0.1.1
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

volumes:
  melodarr_proxy_data:
COMPOSE

cd /opt/melodarr-proxy
docker compose up -d

echo
echo "Melodarr Proxy installed."
echo "Test locally with:"
echo "  curl http://127.0.0.1:${HOST_PORT}/api/health"
EOF

chmod +x "$BOOTSTRAP_SCRIPT"

echo "Pushing bootstrap script into container..."
pct push "$CTID" "$BOOTSTRAP_SCRIPT" /root/melodarr-proxy-bootstrap.sh -perms 755

echo "Running bootstrap inside container..."
pct exec "$CTID" -- bash /root/melodarr-proxy-bootstrap.sh

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

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

# Create an upgrade script to run INSIDE the container
UPGRADE_SCRIPT="/tmp/melodarr-upgrade-${CTID}.sh"

cat << 'EOF_CONTAINER' > "$UPGRADE_SCRIPT"
#!/usr/bin/env bash
set -euo pipefail

# Determine docker compose command
if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker-compose"
else
  echo "Error: Neither 'docker compose' nor 'docker-compose' found"
  exit 1
fi

# Ensure Docker IPv6 is enabled for MusicBrainz connectivity
if ! docker network inspect bridge 2>/dev/null | grep -q '"EnableIPv6": true'; then
  echo "Enabling IPv6 in Docker daemon to fix MusicBrainz connectivity..."
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json << 'JSON'
{
  "ipv6": true,
  "fixed-cidr-v6": "fd00:dead:beef::/64",
  "ip6tables": true,
  "experimental": true
}
JSON
  systemctl restart docker
  sleep 5
  
  if [[ -d "/opt/melodarr-proxy" ]] && [[ -f "/opt/melodarr-proxy/compose.yml" ]]; then
    echo "Recreating existing Docker compose networks to apply IPv6..."
    cd /opt/melodarr-proxy && $DOCKER_COMPOSE down && $DOCKER_COMPOSE up -d
  fi
fi

command -v jq >/dev/null || { echo "jq is required"; exit 1; }

COMPOSE_FILE="/opt/melodarr-proxy/compose.yml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Error: $COMPOSE_FILE not found in container."
  echo "Is this a valid Melodarr Proxy container?"
  exit 1
fi

echo "Checking installation type..."
cd /opt/melodarr-proxy

IS_SOURCE_BUILD=$(grep -c "image: melodarr-proxy:local" "$COMPOSE_FILE" || true)

if grep -q "devdash\|melodarr-proxy-devdash\|DEVDASH" "$COMPOSE_FILE"; then
  echo "Renaming legacy DevDash compose entries to Melodash..."
  sed -i \
    -e 's/devdash/melodash/g' \
    -e 's/DevDash/Melodash/g' \
    -e 's/DEVDASH/MELODASH/g' \
    -e 's/melodarr-proxy-devdash/melodarr-proxy-melodash/g' \
    -e 's#src/devdash#melodash#g' \
    -e 's#\./devdash#\./melodash#g' \
    "$COMPOSE_FILE"
fi

# Ensure REQUIRE_API_KEY is present
if ! grep -q "REQUIRE_API_KEY" "$COMPOSE_FILE"; then
  echo "Disabling API Key requirement for Lidarr compatibility..."
  # Safely append REQUIRE_API_KEY below PORT: 3000
  awk '/PORT: 3000/ && !inserted {
    print $0
    print "      REQUIRE_API_KEY: \"false\""
    inserted = 1
    next
  }
  { print }' "$COMPOSE_FILE" > "${COMPOSE_FILE}.tmp" && mv "${COMPOSE_FILE}.tmp" "$COMPOSE_FILE"
fi

# Clean up broken YAML formatting if a previous run messed it up with backslashes
sed -i 's/^[[:space:]]*\\*[[:space:]]*REQUIRE_API_KEY/      REQUIRE_API_KEY/g' "$COMPOSE_FILE" || true

# Test configuration before proceeding
if ! $DOCKER_COMPOSE config >/dev/null 2>&1; then
  echo "WARNING: compose.yml contains invalid YAML. Attempting to fix common issues..."
  # Try to fix the exact known issue by aggressively stripping backslashes globally on that line
  sed -i '/REQUIRE_API_KEY/s/\\//g' "$COMPOSE_FILE" || true
  if ! $DOCKER_COMPOSE config >/dev/null 2>&1; then
    echo "ERROR: compose.yml is still invalid."
    if [[ "$IS_SOURCE_BUILD" -eq 0 ]]; then
      echo "Downloading fresh compose.yml from repository..."
      curl -sL "https://raw.githubusercontent.com/melodarr/lidarr-lite-proxy/main/compose.yml" > "$COMPOSE_FILE"
      # re-apply API key disablement
      awk '/PORT: 3000/ && !inserted { print $0; print "      REQUIRE_API_KEY: \"false\""; inserted = 1; next } { print }' "$COMPOSE_FILE" > "${COMPOSE_FILE}.tmp" && mv "${COMPOSE_FILE}.tmp" "$COMPOSE_FILE"
    else
      echo "Please fix compose.yml manually:"
      $DOCKER_COMPOSE config
      exit 1
    fi
  fi
fi

HAS_MELODASH=$($DOCKER_COMPOSE config --services 2>/dev/null | grep -cx melodash || true)

if [[ "$HAS_MELODASH" -eq 0 ]]; then
  echo "Melodash service missing from compose.yml. Adding it now..."
  awk '
    /^volumes:/ && !inserted {
      print ""
      print "  melodash:"
      print "    image: ghcr.io/melodarr/melodarr-proxy-melodash:latest"
      print "    restart: unless-stopped"
      print "    environment:"
      print "      PORT: 3000"
      print "      PROXY_API_URL: http://proxy:3000/api"
      print "    ports:"
      print "      - \"55026:3000\""
      print "    depends_on:"
      print "      - proxy"
      inserted = 1
    }
    { print }
  ' "$COMPOSE_FILE" > "${COMPOSE_FILE}.tmp" && mv "${COMPOSE_FILE}.tmp" "$COMPOSE_FILE"
fi

if [[ "$IS_SOURCE_BUILD" -gt 0 ]]; then
  echo "Detected SOURCE BUILD fallback installation."
  echo "Pulling latest code from git..."
  cd /opt/melodarr-proxy/src && git fetch --all && git reset --hard origin/main && git pull
  
  echo "Building new local image..."
  cd /opt/melodarr-proxy && docker build -t melodarr-proxy:local --target production src/
else
  echo "Detected STANDARD IMAGE installation."
  echo "Pulling latest Docker images..."
  cd /opt/melodarr-proxy && $DOCKER_COMPOSE pull proxy melodash
fi

echo "=========================================================="
echo "Starting Canary Deployment and Contract Validation..."
echo "=========================================================="

# Determine network
cd /opt/melodarr-proxy
NETWORK=$($DOCKER_COMPOSE ps -q proxy | xargs docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null | head -n 1 || true)
if [[ -z "$NETWORK" ]]; then
  NETWORK=$(docker network ls --format '{{.Name}}' | grep proxy | head -n 1 || true)
  if [[ -z "$NETWORK" ]]; then
    NETWORK="melodarr-proxy_default"
  fi
fi

if [[ "$IS_SOURCE_BUILD" -gt 0 ]]; then
  CANARY_IMAGE="melodarr-proxy:local"
else
  CANARY_IMAGE="ghcr.io/melodarr/melodarr-proxy:latest"
fi

echo "Running canary container on network $NETWORK..."
docker rm -f melodarr-proxy-canary >/dev/null 2>&1 || true
CANARY_ID=$(docker run -d --name melodarr-proxy-canary --cap-add=NET_ADMIN --network "$NETWORK" -p 3056:3000 -e REDIS_URL=redis://redis:6379 -e NODE_OPTIONS=--dns-result-order=ipv4first "$CANARY_IMAGE")

echo "Waiting 5s for canary to initialize..."
sleep 5

echo "Executing Golden Query Contract Validation..."
SUCCESS=0
for i in {1..3}; do
  HTTP_STATUS=$(curl -o /tmp/canary_response.json -w "%{http_code}" --max-time 2 -s "http://127.0.0.1:3056/api/v0.4/artist/lookup?term=beatles" || echo "000")
  RESPONSE=$(cat /tmp/canary_response.json 2>/dev/null || echo "")
  rm -f /tmp/canary_response.json
  
  if [[ "$HTTP_STATUS" == "200" ]] && [[ -n "$RESPONSE" ]]; then
    if echo "$RESPONSE" | jq -e '(type == "array") and (length > 0) and (.[0] | has("foreignArtistId")) and (.[0] | has("artistName")) and (.[0] | has("images")) and (.[0] | has("overview")) and (.[0].images | type == "array") and (.[0].schemaVersion == "skyhook-v1")' >/dev/null 2>&1 && \
       echo "$RESPONSE" | jq -e '.[0].artistName | test("Beatles"; "i")' >/dev/null 2>&1; then
      
      echo "Schema validation passed. Testing Negative Query..."
      RESPONSE_NEG=$(curl --max-time 2 -s "http://127.0.0.1:3056/api/v0.4/artist/lookup?term=asdasdnonexistent" || echo "")
      if echo "$RESPONSE_NEG" | jq -e 'type == "array" and length == 0' >/dev/null 2>&1; then
        
        echo "Negative query passed. Testing Cache Fallback Resilience..."
        docker exec -u root melodarr-proxy-canary sh -c "command -v iptables >/dev/null || (if command -v apk >/dev/null; then apk add --quiet --no-cache iptables; else apt-get update -qq >/dev/null && apt-get install -qq -y iptables >/dev/null; fi)"
        docker exec -u root melodarr-proxy-canary iptables -A OUTPUT -p tcp --dport 443 -j REJECT
        
        CACHE_HTTP_STATUS=$(curl -o /tmp/canary_cache.json -w "%{http_code}" --max-time 2 -s "http://127.0.0.1:3056/api/v0.4/artist/lookup?term=beatles" || echo "000")
        RESPONSE_CACHE=$(cat /tmp/canary_cache.json 2>/dev/null || echo "")
        rm -f /tmp/canary_cache.json
        
        if [[ "$CACHE_HTTP_STATUS" == "200" ]] && [[ -n "$RESPONSE_CACHE" ]] && \
           echo "$RESPONSE_CACHE" | jq -e '(type == "array") and (length > 0) and (.[0] | has("foreignArtistId")) and (.[0] | has("artistName")) and (.[0] | has("images")) and (.[0] | has("overview")) and (.[0].images | type == "array") and (.[0].schemaVersion == "skyhook-v1")' >/dev/null 2>&1 && \
           echo "$RESPONSE_CACHE" | jq -e '.[0].artistName | test("Beatles"; "i")' >/dev/null 2>&1; then
          
          docker exec -u root melodarr-proxy-canary iptables -D OUTPUT -p tcp --dport 443 -j REJECT || true
          SUCCESS=1
          break
        else
          echo "Cache fallback validation failed."
        fi
        
        docker exec -u root melodarr-proxy-canary iptables -D OUTPUT -p tcp --dport 443 -j REJECT || true
      else
        echo "Negative query validation failed."
      fi
    else
      echo "Schema validation failed! Response did not match SkyHook expectations."
    fi
  fi
  sleep 2
done

if [[ "$SUCCESS" -eq 1 ]]; then
  echo "✅ Canary Contract Validation PASSED!"
  echo "Recreating and restarting main containers..."
  cd /opt/melodarr-proxy && $DOCKER_COMPOSE up -d proxy redis melodash
  
  echo "Cleaning up canary container..."
  docker rm -f "$CANARY_ID" >/dev/null
  
  echo "Running Post-Promotion Validation on main proxy..."
  sleep 5
  if curl --max-time 2 -sf http://127.0.0.1:3055/api/health > /dev/null; then
    echo "✅ Main proxy is healthy post-promotion!"
  else
    echo "❌ WARNING: Main proxy health check failed post-promotion!"
  fi
else
  echo "❌ Canary Contract Validation FAILED!"
  echo "Golden Query response was invalid or missing expected SkyHook schema fields."
  echo "--- Canary Logs ---"
  docker logs "$CANARY_ID"
  echo "-------------------"
  echo "Aborting deployment. Main container remains untouched."
  docker rm -f "$CANARY_ID" >/dev/null
  exit 1
fi

echo "Cleaning up dangling images to save space..."
docker image prune -f
EOF_CONTAINER

# Push script into container and run it
pct push "$CTID" "$UPGRADE_SCRIPT" /root/upgrade.sh -perms 755
pct exec "$CTID" -- bash /root/upgrade.sh

# Cleanup
pct exec "$CTID" -- rm /root/upgrade.sh
rm "$UPGRADE_SCRIPT"

echo "=========================================================="
echo "Upgrade Complete!"
echo "Verify status with:"
echo "  pct exec $CTID -- docker ps"
echo "  pct exec $CTID -- curl -s http://127.0.0.1:3055/api/health"
echo "  open http://<lxc-ip>:55026/dashboard"
echo "=========================================================="


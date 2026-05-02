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

cd "$(dirname "$0")/.."

command -v jq >/dev/null || { echo "jq is required"; exit 1; }

# Check if a specific version/tag is provided, otherwise use latest
TAG=${1:-latest}
CANARY_IMAGE="ghcr.io/melodarr/melodarr-proxy:canary"
LATEST_IMAGE="ghcr.io/melodarr/melodarr-proxy:$TAG"

echo "=========================================================="
echo "Upgrading Melodarr Proxy to $TAG using Canary Validation"
echo "=========================================================="

# Determine the Docker network currently used by the proxy
NETWORK=$($DOCKER_COMPOSE ps -q proxy | xargs docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' | head -n 1)

if [[ -z "$NETWORK" ]]; then
  echo "Could not determine Docker network. Is the proxy currently running?"
  exit 1
fi

echo "1. Pulling new image as canary..."
docker pull "$LATEST_IMAGE"
docker tag "$LATEST_IMAGE" "$CANARY_IMAGE"

echo "2. Starting canary container on network $NETWORK (port 3056)..."
# We start it mapping 3056 to 3000 to avoid conflicting with the main proxy
CANARY_ID=$(docker run -d --name melodarr-proxy-canary --cap-add=NET_ADMIN --network "$NETWORK" -p 3056:3000 -e REDIS_URL=redis://redis:6379 -e NODE_OPTIONS=--dns-result-order=ipv4first -e APP_NAME=melodarr-proxy-canary -e APP_VERSION=canary -e APP_CONTACT=admin@example.com "$CANARY_IMAGE")

echo "3. Waiting 5s for canary to initialize..."
sleep 5

echo "4. Running Health Check and Golden Query Validation..."
SUCCESS=0
for i in {1..5}; do
  if curl --max-time 2 -sf http://127.0.0.1:3056/api/health > /dev/null; then
    echo "Health check passed. Validating SkyHook contract..."
    
    HTTP_STATUS=$(curl -o /tmp/canary_response.json -w "%{http_code}" --max-time 2 -s "http://127.0.0.1:3056/api/v0.4/artist/lookup?term=beatles" || echo "000")
    RESPONSE=$(cat /tmp/canary_response.json 2>/dev/null || echo "")
    rm -f /tmp/canary_response.json
    
    if [[ "$HTTP_STATUS" == "200" ]] && [[ -n "$RESPONSE" ]]; then
      # Strict SkyHook schema and Semantic validation
      if echo "$RESPONSE" | jq -e '(type == "array") and (length > 0) and (.[0] | has("id")) and (.[0] | has("artistName")) and (.[0] | has("images")) and (.[0] | has("overview")) and (.[0].images | type == "array") and (.[0].schemaVersion == "skyhook-v1")' >/dev/null 2>&1 && \
         echo "$RESPONSE" | jq -e '.[0].artistName | test("Beatles"; "i")' >/dev/null 2>&1; then
        
        echo "Schema validation passed. Testing Negative Query..."
        RESPONSE_NEG=$(curl --max-time 2 -s "http://127.0.0.1:3056/api/v0.4/artist/lookup?term=asdasdnonexistent" || echo "")
        
        if echo "$RESPONSE_NEG" | jq -e 'type == "array" and length == 0' >/dev/null 2>&1; then
          echo "Negative query passed. Testing Cache Fallback Resilience..."
          
          # Simulate upstream failure
          docker exec -u root melodarr-proxy-canary sh -c "command -v iptables >/dev/null || (if command -v apk >/dev/null; then apk add --quiet --no-cache iptables; else apt-get update -qq >/dev/null && apt-get install -qq -y iptables >/dev/null; fi)"
          docker exec -u root melodarr-proxy-canary iptables -A OUTPUT -p tcp --dport 443 -j REJECT
          
          CACHE_HTTP_STATUS=$(curl -o /tmp/canary_cache.json -w "%{http_code}" --max-time 2 -s "http://127.0.0.1:3056/api/v0.4/artist/lookup?term=beatles" || echo "000")
          RESPONSE_CACHE=$(cat /tmp/canary_cache.json 2>/dev/null || echo "")
          rm -f /tmp/canary_cache.json
          
          if [[ "$CACHE_HTTP_STATUS" == "200" ]] && [[ -n "$RESPONSE_CACHE" ]] && \
             echo "$RESPONSE_CACHE" | jq -e '(type == "array") and (length > 0) and (.[0] | has("id")) and (.[0] | has("artistName")) and (.[0] | has("images")) and (.[0] | has("overview")) and (.[0].images | type == "array") and (.[0].schemaVersion == "skyhook-v1")' >/dev/null 2>&1 && \
             echo "$RESPONSE_CACHE" | jq -e '.[0].artistName | test("Beatles"; "i")' >/dev/null 2>&1; then
            
            docker exec -u root melodarr-proxy-canary iptables -D OUTPUT -p tcp --dport 443 -j REJECT || true
            SUCCESS=1
            break
          else
            echo "Cache fallback validation failed."
          fi
          
          # Unblock for next iteration if failed
          docker exec -u root melodarr-proxy-canary iptables -D OUTPUT -p tcp --dport 443 -j REJECT || true
        else
          echo "Negative query validation failed."
        fi
      else
        echo "Schema validation failed! Response did not match SkyHook expectations."
      fi
    fi
  fi
  sleep 2
done

if [[ "$SUCCESS" -eq 1 ]]; then
  echo "✅ Canary Health Check PASSED!"
  echo "5. Updating latest image and restarting main container..."
  
  # Ensure the compose file uses the expected tag, or just pull and up if it uses latest
  $DOCKER_COMPOSE pull proxy
  $DOCKER_COMPOSE up -d proxy
  
  echo "6. Removing canary container..."
  docker rm -f "$CANARY_ID" >/dev/null
  docker rmi "$CANARY_IMAGE" >/dev/null 2>&1 || true
  
  echo "7. Running Post-Promotion Validation on main proxy..."
  sleep 5
  if curl --max-time 2 -sf http://127.0.0.1:3055/api/health > /dev/null; then
    echo "✅ Main proxy is healthy post-promotion!"
  else
    echo "❌ WARNING: Main proxy health check failed post-promotion!"
  fi
  
  echo "Upgrade successful!"
else
  echo "❌ Canary Health Check FAILED!"
  echo "Aborting upgrade. Main container remains untouched."
  
  echo "--- Canary Logs ---"
  docker logs "$CANARY_ID"
  
  echo "Stopping and removing canary container..."
  docker rm -f "$CANARY_ID" >/dev/null
  docker rmi "$CANARY_IMAGE" >/dev/null 2>&1 || true
  
  exit 1
fi

#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${MELODASH_BASE_URL:-http://127.0.0.1:${MELODASH_HOST_PORT:-55026}}"

routes=(
  "/"
  "/dashboard"
  "/settings"
  "/explorer"
  "/requests"
  "/analytics"
  "/insights"
  "/updates"
  "/service/melodarr-proxy"
  "/docs"
  "/openapi.json"
)

echo "Running Melodash route smoke test against ${BASE_URL}"

for route in "${routes[@]}"; do
  url="${BASE_URL%/}${route}"
  status="$(curl -L -sS -o /tmp/melodash-route-smoke.out -w '%{http_code}' "$url")"
  if [[ "$status" -lt 200 || "$status" -ge 500 ]]; then
    echo "FAIL ${route}: HTTP ${status}"
    cat /tmp/melodash-route-smoke.out || true
    rm -f /tmp/melodash-route-smoke.out
    exit 1
  fi
  echo "OK ${route}: HTTP ${status}"
done

rm -f /tmp/melodash-route-smoke.out
echo "Melodash route smoke test passed."

#!/usr/bin/env bash
# test-install.sh — repeatable end-to-end tests for a deployed Melodarr
# Proxy install. Runs against a Proxmox LXC via `pct exec` (set CTID),
# or directly against any reachable URL (set BASE_URL).
#
# Usage:
#   CTID=163 ./test-install.sh                                  # from Proxmox host
#   BASE_URL=https://melodarr-proxy.prgs.cc ./test-install.sh   # remote
#   ./test-install.sh                                           # local (BASE_URL=http://127.0.0.1:3055)
#
# Add new checks by appending a `run_test "name" some_check_function`
# line in main(). Each check function exits 0 on pass, nonzero on fail
# and may write extra detail to FAIL_DETAIL.

set -u

BASE_URL="${BASE_URL:-http://127.0.0.1:3055}"
MELODASH_PORT="${MELODASH_PORT:-55026}"
# Derive a melodash URL from BASE_URL by swapping the port. If BASE_URL
# has no explicit port, append :MELODASH_PORT to its host.
default_melodash_url () {
  local u="$BASE_URL"
  if [[ "$u" =~ ^(https?://[^/:]+)(:[0-9]+)?(/.*)?$ ]]; then
    printf '%s:%s' "${BASH_REMATCH[1]}" "$MELODASH_PORT"
  else
    printf '%s' "$u"
  fi
}
MELODASH_URL="${MELODASH_URL:-$(default_melodash_url)}"
CTID="${CTID:-}"
PROXY_CONTAINER="${PROXY_CONTAINER:-melodarr-proxy-proxy-1}"

PASS=0
FAIL=0
FAIL_DETAIL=""

color () {
  local c="$1"
  shift
  if [[ -t 1 ]]; then
    printf '\033[%sm%s\033[0m' "$c" "$*"
  else
    printf '%s' "$*"
  fi
}

green ()  { color "32" "$@"; }
red ()    { color "31" "$@"; }
yellow () { color "33" "$@"; }

run_test () {
  local name="$1"
  shift
  FAIL_DETAIL=""
  if "$@"; then
    printf '  [%s] %s\n' "$(green PASS)" "$name"
    PASS=$((PASS + 1))
  else
    printf '  [%s] %s\n' "$(red FAIL)" "$name"
    if [[ -n "$FAIL_DETAIL" ]]; then
      printf '         %s\n' "$FAIL_DETAIL"
    fi
    FAIL=$((FAIL + 1))
  fi
}

# Run curl from inside the LXC if CTID is set, else from this host.
lxc_curl () {
  if [[ -n "$CTID" ]]; then
    pct exec "$CTID" -- curl "$@"
  else
    curl "$@"
  fi
}

# Run curl from inside the proxy docker container (requires CTID).
container_curl () {
  if [[ -z "$CTID" ]]; then
    return 1
  fi
  pct exec "$CTID" -- docker exec "$PROXY_CONTAINER" curl "$@"
}

# ---- individual checks ----

check_health_ok () {
  local body
  body=$(lxc_curl -fsS -m 5 "$BASE_URL/api/health" 2>&1) || {
    FAIL_DETAIL="curl failed: $body"
    return 1
  }
  if ! printf '%s' "$body" | grep -q '"status":"ok"'; then
    FAIL_DETAIL="health body: $(printf '%s' "$body" | head -c 200)"
    return 1
  fi
}

check_ready_responds () {
  local code
  code=$(lxc_curl -sS -m 5 -o /dev/null -w "%{http_code}" "$BASE_URL/api/ready" 2>/dev/null)
  if [[ "$code" =~ ^(200|503)$ ]]; then
    return 0
  fi
  FAIL_DETAIL="status code: $code"
  return 1
}

check_upstream_healthy () {
  local body
  body=$(lxc_curl -fsS -m 5 "$BASE_URL/api/ready" 2>&1) || {
    FAIL_DETAIL="readiness fetch failed"
    return 1
  }
  if printf '%s' "$body" | grep -q '"upstream":"healthy"'; then
    return 0
  fi
  local upstream lasterr
  upstream=$(printf '%s' "$body" | grep -oE '"upstream":"[^"]*"' | head -1)
  lasterr=$(printf '%s' "$body" | grep -oE '"message":"[^"]*"' | head -1)
  FAIL_DETAIL="${upstream} ${lasterr}"
  return 1
}

check_version () {
  local body
  body=$(lxc_curl -fsS -m 5 "$BASE_URL/api/version" 2>&1) || return 1
  printf '%s' "$body" | grep -q '"version"'
}

check_redis_connected () {
  local body
  body=$(lxc_curl -fsS -m 5 "$BASE_URL/api/ready" 2>&1) || return 1
  printf '%s' "$body" | grep -q '"redisConnected":true'
}

check_melodash_html () {
  local headers
  headers=$(lxc_curl -fsSI -m 5 "$MELODASH_URL/" 2>&1) || {
    FAIL_DETAIL="melodash fetch failed: $headers"
    return 1
  }
  if printf '%s' "$headers" | grep -qiE 'content-type:.*text/html'; then
    return 0
  fi
  FAIL_DETAIL="no text/html content-type from $MELODASH_URL"
  return 1
}

check_search_e2e () {
  local body
  body=$(lxc_curl -fsS -m 15 "$BASE_URL/api/search?q=radiohead" 2>&1) || {
    FAIL_DETAIL="search request failed: $body"
    return 1
  }
  if printf '%s' "$body" | grep -q '"error"'; then
    FAIL_DETAIL="search returned error: $(printf '%s' "$body" | head -c 200)"
    return 1
  fi
  if printf '%s' "$body" | grep -qE '"album|"artist'; then
    return 0
  fi
  FAIL_DETAIL="search returned no albums/artists: $(printf '%s' "$body" | head -c 200)"
  return 1
}

check_lxc_ipv6_to_mb () {
  if [[ -z "$CTID" ]]; then
    FAIL_DETAIL="skipped (no CTID)"
    return 0
  fi
  local code
  code=$(pct exec "$CTID" -- curl -sS -m 5 -6 -o /dev/null -w "%{http_code}" \
    -A "test/1.0 (admin@example.com)" \
    "https://musicbrainz.org/ws/2/artist/?query=test&fmt=json&limit=1" 2>&1) || true
  if [[ "$code" == "200" ]]; then
    return 0
  fi
  FAIL_DETAIL="LXC IPv6→MB returned: ${code:-no output}"
  return 1
}

# Probe the proxy container's IPv6 path to MusicBrainz directly. This is
# the layer that fails when the LXC has IPv6 but Docker's default bridge
# does not.
check_container_ipv6_to_mb () {
  if [[ -z "$CTID" ]]; then
    FAIL_DETAIL="skipped (no CTID)"
    return 0
  fi
  local code
  code=$(pct exec "$CTID" -- docker exec "$PROXY_CONTAINER" \
    sh -c 'curl -sS -m 5 -6 -o /dev/null -w "%{http_code}" -A "test/1.0 (admin@example.com)" "https://musicbrainz.org/ws/2/artist/?query=test&fmt=json&limit=1"' 2>&1) || true
  if [[ "$code" == "200" ]]; then
    return 0
  fi
  FAIL_DETAIL="container IPv6→MB returned: ${code:-no output} (likely Docker IPv6 not enabled)"
  return 1
}

check_proxy_container_ipv6_network () {
  if [[ -z "$CTID" ]]; then
    FAIL_DETAIL="skipped (no CTID)"
    return 0
  fi
  if pct exec "$CTID" -- env PROXY_CONTAINER="$PROXY_CONTAINER" bash -lc '
    set -e
    networks=$(docker inspect "$PROXY_CONTAINER" --format "{{range \$name, \$net := .NetworkSettings.Networks}}{{println \$name}}{{end}}" 2>/dev/null)
    for network in $networks; do
      if docker network inspect "$network" 2>/dev/null | grep -q "\"EnableIPv6\": true"; then
        exit 0
      fi
    done
    exit 1
  ' >/dev/null 2>&1; then
    return 0
  fi
  FAIL_DETAIL="proxy container is not attached to an IPv6-enabled Docker network"
  return 1
}

# ---- main ----

main () {
  printf '%s\n' "================================================="
  printf '  Melodarr Proxy install tests\n'
  printf '  proxy:    %s\n' "$BASE_URL"
  printf '  melodash: %s\n' "$MELODASH_URL"
  if [[ -n "$CTID" ]]; then
    printf '  via:      pct exec %s\n' "$CTID"
  fi
  printf '%s\n' "================================================="

  run_test "proxy /api/health returns status:ok"             check_health_ok
  run_test "proxy /api/ready responds (200 or 503)"          check_ready_responds
  run_test "proxy /api/version returns a version string"     check_version
  run_test "proxy reports redis connected"                   check_redis_connected
  run_test "melodash serves HTML on its host port"           check_melodash_html
  run_test "LXC can reach MusicBrainz over IPv6"             check_lxc_ipv6_to_mb
  run_test "proxy container Docker network has IPv6 enabled" check_proxy_container_ipv6_network
  run_test "proxy CONTAINER can reach MusicBrainz over IPv6" check_container_ipv6_to_mb
  run_test "proxy upstream resolves to healthy"              check_upstream_healthy
  run_test "end-to-end /api/search returns results"          check_search_e2e

  printf '%s\n' "-------------------------------------------------"
  if [[ "$FAIL" -eq 0 ]]; then
    printf '  %s — all %d checks pass\n' "$(green PASS)" "$PASS"
    exit 0
  fi

  printf '  %d %s, %d %s\n' "$PASS" "$(green pass)" "$FAIL" "$(red fail)"
  printf '\n  %s\n' "$(yellow Hints:)"
  printf '    * "container IPv6→MB" fail + "LXC IPv6→MB" pass = Docker IPv6 missing.\n'
  printf '      One-time fix on the LXC:\n'
  printf '        cat > /etc/docker/daemon.json <<JSON\n'
  printf '        cd /opt/melodarr-proxy/src-branch-build\n'
  printf '        ./scripts/ensure-docker-ipv6.sh\n'
  printf '        cd /opt/melodarr-proxy && docker compose up -d --force-recreate\n'
  printf '    * "LXC IPv6→MB" fail = the LXC itself has no IPv6 default route.\n'
  printf '    * upstream unreachable but search returns ECONNRESET = network layer\n'
  printf '      is the issue, not the proxy. Tail proxy logs:\n'
  printf '        pct exec %s -- docker compose -f /opt/melodarr-proxy/compose.yml logs --tail=80 proxy\n' "${CTID:-<CTID>}"
  exit 1
}

main "$@"

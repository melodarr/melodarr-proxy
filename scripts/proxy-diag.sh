#!/usr/bin/env bash
# proxy-diag.sh — manual probes and lightweight repair tools for the
# Melodarr proxy. Designed to run from:
#   - the Proxmox host (uses `pct exec $CTID`)
#   - inside the LXC (operates on /opt/melodarr-proxy directly)
#   - any host with curl pointed at $BASE_URL
#
# Usage:
#   proxy-diag.sh <command> [args...]
#
# Commands:
#   health                       GET /api/health
#   ready                        GET /api/ready
#   version                      GET /api/version
#   diagnose                     GET /debug/diagnose?provider=musicbrainz
#   mb [6]                       Direct IPv6 TLS probe to MusicBrainz
#   search <query>               GET /api/search?q=...
#   login                        Interactive login, store cookie at /tmp/melodarr-proxy.cookie
#   stats                        GET /api/stats (requires login)
#   settings                     GET /api/settings (requires login)
#   logs [N]                     Tail N (default 100) lines from the proxy container
#   set-ip-family 6              Set MUSICBRAINZ_IP_FAMILY=6 in compose.yml and restart proxy
#   compose-cat                  Print the deployed compose.yml
#   compose-validate             Validate the deployed compose.yml YAML
#   all                          Run read-only probes (health, ready, version, mb)
#   help                         Show this message
#
# Environment overrides:
#   BASE_URL    Proxy base URL (default: http://127.0.0.1:3055)
#   CTID        Proxmox CT ID. If set and `pct` is available, commands
#               that need filesystem/docker access run via `pct exec $CTID`.
#   COOKIE_JAR  Path to the cookie jar (default: /tmp/melodarr-proxy.cookie)

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3055}"
CTID="${CTID:-}"
COOKIE_JAR="${COOKIE_JAR:-/tmp/melodarr-proxy.cookie}"
COMPOSE_PATH="${COMPOSE_PATH:-/opt/melodarr-proxy/compose.yml}"

have_pct () { command -v pct >/dev/null 2>&1 && [[ -n "$CTID" ]]; }

# Run a shell snippet either directly (in the LXC) or via `pct exec` from
# the Proxmox host.
remote_sh () {
  if have_pct; then
    pct exec "$CTID" -- bash -lc "$1"
  else
    bash -lc "$1"
  fi
}

pretty () {
  if command -v jq >/dev/null 2>&1; then
    jq .
  else
    cat
  fi
}

probe () {
  local path="$1"; shift || true
  local url="${BASE_URL%/}${path}"
  local body_file err_file
  body_file=$(mktemp -t proxy-diag-body.XXXXXX)
  err_file=$(mktemp -t proxy-diag-err.XXXXXX)
  echo "→ ${url}" >&2
  local meta status=0
  meta=$(curl -sS -m 10 -o "$body_file" -w '%{http_code} %{time_total}' "$@" "$url" 2>"$err_file") || status=$?
  cat "$body_file"
  if [[ "$status" -ne 0 ]]; then
    local err
    err=$(tr '\n' ' ' < "$err_file" | sed 's/[[:space:]]\{1,\}/ /g; s/^ //; s/ $//')
    meta="000 -"
    [[ -n "$err" ]] && printf '\n[curl error %s] %s\n' "$status" "$err" >&2
  fi
  rm -f "$body_file" "$err_file"
  # shellcheck disable=SC2086
  printf '\n[HTTP %s] [%ss]\n' $meta >&2
}

cmd_health ()  { probe /api/health  | pretty; }
cmd_ready ()   { probe /api/ready   | pretty; }
cmd_version () { probe /api/version | pretty; }
cmd_diagnose () { probe "/debug/diagnose?provider=musicbrainz" | pretty; }

cmd_mb () {
  local family="${1:-6}"
  case "$family" in
    6|"") ;;
    *) echo "mb: MusicBrainz is IPv6-only for this proxy; family must be 6" >&2; exit 2 ;;
  esac
  echo "Direct probe → https://musicbrainz.org/ws/2/artist/?query=test&fmt=json&limit=1 (family=6)"
  local app_contact="${APP_CONTACT:-https://github.com/melodarr/melodarr-proxy}"
  curl -sS -m 10 -6 \
    -H "User-Agent: melodarr-proxy-diag/1.0 (${app_contact})" \
    -o /dev/null \
    -w "[HTTP %{http_code}] [%{time_total}s] [%{remote_ip}]\n" \
    "https://musicbrainz.org/ws/2/artist/?query=test&fmt=json&limit=1" \
    || echo "request failed"
}

cmd_search () {
  local q="${1:-}"
  if [[ -z "$q" ]]; then
    echo "search: missing query. usage: proxy-diag.sh search <query>" >&2
    exit 2
  fi
  probe "/api/search?q=$(printf %s "$q" | sed 's/ /%20/g')" | pretty
}

cmd_login () {
  if [[ ! -t 0 ]]; then
    echo "login: needs an interactive TTY for the password prompt" >&2
    exit 2
  fi
  read -rp "Password: " -s password
  echo
  printf '{"password":"%s"}' "$password" | \
    curl -sS -m 10 \
      -c "$COOKIE_JAR" \
      -H "Content-Type: application/json" \
      -d @- \
      -w "\n[HTTP %{http_code}]\n" \
      "${BASE_URL%/}/api/settings/login" \
    | pretty
  echo "Cookie jar: $COOKIE_JAR"
}

cmd_stats ()    { probe /api/stats    -b "$COOKIE_JAR" | pretty; }
cmd_settings () { probe /api/settings -b "$COOKIE_JAR" | pretty; }

cmd_logs () {
  local n="${1:-100}"
  remote_sh "cd $(dirname "$COMPOSE_PATH") && docker compose logs --tail=$n proxy"
}

cmd_compose_cat () {
  remote_sh "cat $COMPOSE_PATH"
}

cmd_compose_validate () {
  remote_sh "docker compose -f $COMPOSE_PATH config >/dev/null && echo 'compose.yml is valid YAML'"
}

# Set or replace MUSICBRAINZ_IP_FAMILY in the deployed compose.yml using
# a Python parse-and-rewrite (preserves indentation and avoids the
# multi-line sed quoting trap that mangles YAML).
cmd_set_ip_family () {
  local family="${1:-}"
  case "$family" in
    6) ;;
    *) echo "set-ip-family: MusicBrainz is IPv6-only for this proxy; argument must be 6" >&2; exit 2 ;;
  esac

  local py_b64
  py_b64=$(cat <<'PY' | base64 | tr -d '\n'
import re, sys, pathlib
path = pathlib.Path(sys.argv[1])
family = sys.argv[2]
text = path.read_text()
line_re = re.compile(r"(^[ \t]*)MUSICBRAINZ_IP_FAMILY:.*$", re.MULTILINE)
value = f'"{family}"'
if line_re.search(text):
    text = line_re.sub(lambda m: f'{m.group(1)}MUSICBRAINZ_IP_FAMILY: {value}', text)
else:
    anchor = re.compile(r"(^([ \t]*)MUSICBRAINZ_BASE_URL:.*$)", re.MULTILINE)
    m = anchor.search(text)
    if not m:
        print("ERROR: MUSICBRAINZ_BASE_URL anchor not found; refusing to edit blindly", file=sys.stderr)
        sys.exit(2)
    indent = m.group(2)
    insertion = f'{m.group(1)}\n{indent}MUSICBRAINZ_IP_FAMILY: {value}'
    text = text[:m.start()] + insertion + text[m.end():]
path.write_text(text)
print(f"Set MUSICBRAINZ_IP_FAMILY={family} in {path}")
PY
  )

  remote_sh "
    set -e
    if ! command -v python3 >/dev/null 2>&1; then
      echo 'python3 not found in container/host' >&2; exit 2
    fi
    echo '${py_b64}' | base64 -d | python3 - '${COMPOSE_PATH}' '${family}'
    cd \"\$(dirname '${COMPOSE_PATH}')\"
    docker compose -f '${COMPOSE_PATH}' config >/dev/null
    docker compose up -d --force-recreate proxy
  "
}

cmd_all () {
  echo "=== /api/health ===";  cmd_health
  echo "=== /api/ready ===";   cmd_ready
  echo "=== /api/version ==="; cmd_version
  echo "=== /debug/diagnose?provider=musicbrainz ==="; cmd_diagnose
  echo "=== mb (6) ===";       cmd_mb 6
}

cmd_help () {
  sed -n '2,/^set -euo/p' "$0" | sed -n '2,/^$/p' | sed 's/^# \{0,1\}//'
}

main () {
  local cmd="${1:-help}"
  shift || true
  case "$cmd" in
    health|ready|version|diagnose|stats|settings|login|all|help) cmd_${cmd} "$@" ;;
    mb) cmd_mb "$@" ;;
    search) cmd_search "$@" ;;
    logs) cmd_logs "$@" ;;
    compose-cat) cmd_compose_cat ;;
    compose-validate) cmd_compose_validate ;;
    set-ip-family) cmd_set_ip_family "$@" ;;
    *) echo "Unknown command: $cmd" >&2; cmd_help; exit 2 ;;
  esac
}

main "$@"

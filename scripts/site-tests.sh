#!/usr/bin/env bash
# Verification harness for the deployed melodarr-proxy.
# Runs against an LXC at $CTID over the in-LXC loopback proxy URL.
#
# Env knobs:
#   CTID         — Proxmox container ID         (default: 163)
#   BASE_URL     — proxy URL inside the LXC     (default: http://127.0.0.1:3055)
#   API_KEY      — proxy API key                (default: empty; prompt in interactive mode)
#   SKIP_DEPLOY  — set to 1 to skip pull+up     (default: 0)
#   BRANCH_REMOTE — git remote to fetch/list     (default: origin)
#   LIST_BRANCHES — set to 1 to print deployable remote branches before checks
#   BRANCH_LIST_ONLY — set to 1 with LIST_BRANCHES=1 to list branches and exit
#   BRANCH_LIMIT — max branches to print         (default: 80)
#   LXC_REPO_PATH — source git checkout inside the LXC for branch deploys.
#                  Empty auto-detects /opt/melodarr-proxy/src, then
#                  /opt/melodarr-proxy. Branch listing uses the host checkout
#                  that runs this script first, then falls back to this path.
#   LXC_BRANCH_SOURCE_PATH — scratch source path used for host-branch archive
#                  deploys when the LXC has no source git checkout
#                  (default: /opt/melodarr-proxy/src-branch-build)
#   DEPLOY_BRANCH — branch/ref to deploy before verification.
#                  Empty keeps the old pull+recreate deployment behavior.
#                  When set, the script switches the LXC source checkout,
#                  builds proxy from source, and verifies /api/version against
#                  that checked-out revision.
#   REENABLE_MB  — set to 1 to clear saved metadataProviders/providerPriority
#                  overrides and restart the proxy (re-enables MusicBrainz)
#                  (default: 0 — verify-only, never mutate)
#   SETTINGS_PATH — explicit path to settings.json (default: auto-discover
#                   via /data/settings.json, /opt/melodarr-proxy/data/...,
#                   /config/settings.json, then container-wide find).
#                   Only used when REENABLE_MB=1.
#   EXPECTED_REV — optional git SHA expected from /api/version (default: empty = skip)
#
# Tracks pass/fail per check and exits non-zero if any test failed.

set -uo pipefail

CTID="${CTID:-163}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3055}"
API_KEY="${API_KEY:-}"
SKIP_DEPLOY="${SKIP_DEPLOY:-0}"
BRANCH_REMOTE="${BRANCH_REMOTE:-origin}"
LIST_BRANCHES="${LIST_BRANCHES:-0}"
BRANCH_LIST_ONLY="${BRANCH_LIST_ONLY:-0}"
BRANCH_LIMIT="${BRANCH_LIMIT:-80}"
LXC_REPO_PATH="${LXC_REPO_PATH:-}"
LXC_BRANCH_SOURCE_PATH="${LXC_BRANCH_SOURCE_PATH:-/opt/melodarr-proxy/src-branch-build}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-}"
REENABLE_MB="${REENABLE_MB:-0}"
SETTINGS_PATH="${SETTINGS_PATH:-}"
EXPECTED_REV="${EXPECTED_REV:-}"
BRANCHES_LISTED=0
declare -a BRANCH_CHOICES=()
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── Branch listing/deploy helpers ────────────────────────────────
host_git_available () {
  git -C "$BASE_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

resolve_host_deploy_ref () {
  local ref="$DEPLOY_BRANCH" remote_branch="$DEPLOY_BRANCH"
  case "$ref" in
    "$BRANCH_REMOTE"/*) remote_branch="${ref#"$BRANCH_REMOTE"/}" ;;
  esac

  git -C "$BASE_DIR" fetch --prune "$BRANCH_REMOTE" >/dev/null 2>&1
  if git -C "$BASE_DIR" show-ref --verify --quiet "refs/remotes/$BRANCH_REMOTE/$remote_branch"; then
    git -C "$BASE_DIR" rev-parse "$BRANCH_REMOTE/$remote_branch^{commit}"
  else
    git -C "$BASE_DIR" rev-parse "$ref^{commit}"
  fi
}

resolve_lxc_repo_path () {
  if [ -n "$LXC_REPO_PATH" ]; then
    pct exec "$CTID" -- env LXC_REPO_PATH="$LXC_REPO_PATH" bash -lc '
      [ -d "$LXC_REPO_PATH/.git" ] && printf "%s" "$LXC_REPO_PATH"
    ' 2>/dev/null || true
    return
  fi

  pct exec "$CTID" -- bash -lc '
    for path in /opt/melodarr-proxy/src /opt/melodarr-proxy; do
      if [ -d "$path/.git" ]; then
        printf "%s" "$path"
        exit 0
      fi
    done
  ' 2>/dev/null || true
}

list_remote_branches () {
  if host_git_available; then
    git -C "$BASE_DIR" fetch --prune "$BRANCH_REMOTE" >/dev/null 2>&1
    git -C "$BASE_DIR" for-each-ref \
      --sort=-committerdate \
      --format="%(refname:short)%09%(committerdate:short)%09%(subject)" \
      "refs/remotes/$BRANCH_REMOTE" \
      | awk -F "\t" -v head="$BRANCH_REMOTE/HEAD" -v remote="$BRANCH_REMOTE" '$1 != head && $1 != remote { print }' \
      | sed -n "1,${BRANCH_LIMIT}p"
    return
  fi

  local lxc_repo_path
  lxc_repo_path="$(resolve_lxc_repo_path)"
  if [ -z "$lxc_repo_path" ]; then
    echo "ERROR: no git checkout found on the host or inside CTID=$CTID."
    echo "Run this script from the Proxmox-host repo checkout, or set LXC_REPO_PATH to an in-LXC source checkout."
    return 1
  fi

  pct exec "$CTID" -- env BRANCH_REMOTE="$BRANCH_REMOTE" BRANCH_LIMIT="$BRANCH_LIMIT" LXC_REPO_PATH="$lxc_repo_path" bash -lc '
    set -euo pipefail
    cd "$LXC_REPO_PATH"
    git fetch --prune "$BRANCH_REMOTE" >/dev/null 2>&1
    git for-each-ref \
      --sort=-committerdate \
      --format="%(refname:short)%09%(committerdate:short)%09%(subject)" \
      "refs/remotes/$BRANCH_REMOTE" \
      | awk -F "\t" -v head="$BRANCH_REMOTE/HEAD" -v remote="$BRANCH_REMOTE" "\$1 != head && \$1 != remote { print }" \
      | sed -n "1,${BRANCH_LIMIT}p"
  '
}

show_remote_branches () {
  local rows branch date subject display i
  echo
  echo "## Available deploy branches ($BRANCH_REMOTE, newest first)"
  if ! rows="$(list_remote_branches)"; then
    echo "ERROR: unable to list branches."
    exit 1
  fi

  BRANCH_CHOICES=()
  i=1
  while IFS=$'\t' read -r branch date subject; do
    [ -z "$branch" ] && continue
    display="$branch"
    case "$display" in
      "$BRANCH_REMOTE"/*) display="${display#"$BRANCH_REMOTE"/}" ;;
    esac
    BRANCH_CHOICES+=("$display")
    printf "  %2d) %-42s %s  %s\n" "$i" "$display" "$date" "$subject"
    i=$((i + 1))
  done <<< "$rows"

  if [ "${#BRANCH_CHOICES[@]}" -eq 0 ]; then
    echo "ERROR: no remote branches found for $BRANCH_REMOTE."
    exit 1
  fi
  BRANCHES_LISTED=1
}

resolve_branch_selection () {
  local selection="$1"
  if [[ "$selection" =~ ^[0-9]+$ ]] && [ "${#BRANCH_CHOICES[@]}" -gt 0 ]; then
    if [ "$selection" -lt 1 ] || [ "$selection" -gt "${#BRANCH_CHOICES[@]}" ]; then
      echo "ERROR: branch selection $selection is out of range 1-${#BRANCH_CHOICES[@]}."
      exit 1
    fi
    DEPLOY_BRANCH="${BRANCH_CHOICES[$((selection - 1))]}"
    echo "Selected branch: $DEPLOY_BRANCH"
  fi
}

deploy_branch_from_host_archive () {
  if ! host_git_available; then
    return 1
  fi

  local resolved_ref archive rc
  if ! resolved_ref="$(resolve_host_deploy_ref)"; then
    echo "ERROR: unable to resolve DEPLOY_BRANCH=$DEPLOY_BRANCH from host repo $BASE_DIR"
    return 1
  fi

  archive="$(mktemp "${TMPDIR:-/tmp}/melodarr-site-test-source.XXXXXX.tar")" || return 1
  if ! git -C "$BASE_DIR" archive --format=tar "$resolved_ref" > "$archive"; then
    rm -f "$archive"
    return 1
  fi

  pct exec "$CTID" -- mkdir -p /opt/melodarr-proxy || {
    rm -f "$archive"
    return 1
  }
  pct push "$CTID" "$archive" /tmp/melodarr-site-test-source.tar >/dev/null || {
    rm -f "$archive"
    return 1
  }
  rm -f "$archive"

  pct exec "$CTID" -- env DEPLOY_REV="$resolved_ref" LXC_BRANCH_SOURCE_PATH="$LXC_BRANCH_SOURCE_PATH" bash -lc '
    set -euo pipefail
    cd /opt/melodarr-proxy
    compose_file="compose.yml"
    if [ ! -f "$compose_file" ]; then
      compose_file="docker-compose.yml"
    fi
    if [ ! -f "$compose_file" ]; then
      echo "ERROR: no compose.yml or docker-compose.yml found in /opt/melodarr-proxy"
      exit 1
    fi

    rm -rf "$LXC_BRANCH_SOURCE_PATH"
    mkdir -p "$LXC_BRANCH_SOURCE_PATH"
    tar -xf /tmp/melodarr-site-test-source.tar -C "$LXC_BRANCH_SOURCE_PATH"

    docker build \
      -t melodarr-proxy:branch \
      --target production \
      --build-arg APP_REVISION="$DEPLOY_REV" \
      --build-arg APP_CREATED="$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
      "$LXC_BRANCH_SOURCE_PATH"

    cat > compose.site-test-branch.yml <<COMPOSE
services:
  proxy:
    image: melodarr-proxy:branch
COMPOSE

    docker compose -f "$compose_file" -f compose.site-test-branch.yml up -d --force-recreate proxy
    printf "%s" "$DEPLOY_REV" > /opt/melodarr-proxy/.site-test-deployed-revision
    rm -f /tmp/melodarr-site-test-source.tar
  '
}

deploy_branch_ref () {
  local lxc_repo_path
  lxc_repo_path="$(resolve_lxc_repo_path)"
  if [ -z "$lxc_repo_path" ]; then
    echo "No source git checkout found inside CTID=$CTID; deploying DEPLOY_BRANCH from host repo archive instead."
    deploy_branch_from_host_archive
    return
  fi

  pct exec "$CTID" -- env BRANCH_REMOTE="$BRANCH_REMOTE" DEPLOY_BRANCH="$DEPLOY_BRANCH" LXC_REPO_PATH="$lxc_repo_path" bash -lc '
    set -euo pipefail
    cd "$LXC_REPO_PATH"

    if [ -n "$(git status --porcelain)" ]; then
      echo "ERROR: $LXC_REPO_PATH has uncommitted changes; refusing to switch branches."
      echo "Commit, stash, or clean that deployment checkout before using DEPLOY_BRANCH."
      git status --short
      exit 2
    fi

    git fetch --prune "$BRANCH_REMOTE"

    ref="$DEPLOY_BRANCH"
    remote_branch="$ref"
    case "$ref" in
      "$BRANCH_REMOTE"/*) remote_branch="${ref#"$BRANCH_REMOTE"/}" ;;
    esac

    if git show-ref --verify --quiet "refs/remotes/$BRANCH_REMOTE/$remote_branch"; then
      git switch -C "$remote_branch" "$BRANCH_REMOTE/$remote_branch"
    else
      git switch --detach "$ref"
    fi

    deploy_rev="$(git rev-parse HEAD)"
    if [ "$(basename "$LXC_REPO_PATH")" = "src" ] && [ -f "$(dirname "$LXC_REPO_PATH")/compose.yml" ]; then
      cd "$(dirname "$LXC_REPO_PATH")"
      docker build \
        -t melodarr-proxy:local \
        --target production \
        --build-arg APP_REVISION="$deploy_rev" \
        --build-arg APP_CREATED="$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
        src/
      docker compose up -d --force-recreate proxy
      printf "%s" "$deploy_rev" > /opt/melodarr-proxy/.site-test-deployed-revision
    else
      docker compose up -d --build --force-recreate proxy
      printf "%s" "$deploy_rev" > "$LXC_REPO_PATH/.site-test-deployed-revision"
    fi
  '
}

current_deploy_revision () {
  local lxc_repo_path
  lxc_repo_path="$(resolve_lxc_repo_path)"
  if [ -n "$lxc_repo_path" ]; then
    pct exec "$CTID" -- env LXC_REPO_PATH="$lxc_repo_path" bash -lc 'cd "$LXC_REPO_PATH" && git rev-parse HEAD' 2>/dev/null || true
  else
    pct exec "$CTID" -- cat /opt/melodarr-proxy/.site-test-deployed-revision 2>/dev/null || true
  fi
}

# ── Optional interactive wizard ──────────────────────────────────
# Prompts for each knob when stdin is a TTY.  Users can:
#   - press Enter to accept the default shown in [brackets]
#   - pre-set any var via env to skip that prompt's default
#   - pass INTERACTIVE=0 to bypass the wizard entirely (CI use)
ask () {
  local var="$1" prompt="$2" default="$3" reply
  read -rp "$prompt [$default]: " reply
  printf -v "$var" '%s' "${reply:-$default}"
}
ask_yn () {
  local var="$1" prompt="$2" default="$3" reply hint="(y/N)"
  [ "$default" = "1" ] && hint="(Y/n)"
  read -rp "$prompt $hint: " reply
  case "${reply:-$default}" in
    1|y|Y|yes|YES) printf -v "$var" '%s' "1" ;;
    *)             printf -v "$var" '%s' "0" ;;
  esac
}

if [ -t 0 ] && [ "${INTERACTIVE:-1}" = "1" ]; then
  echo "Melodarr verification harness — interactive setup"
  echo "Press Enter for the default; set INTERACTIVE=0 to skip the wizard."
  echo
  ask    CTID         "Proxmox CTID"                          "$CTID"
  ask    BASE_URL     "Proxy URL inside the LXC"              "$BASE_URL"
  ask    API_KEY      "Proxy API key"                         "$API_KEY"
  ask_yn SKIP_DEPLOY  "Skip pull + recreate of proxy?"        "$SKIP_DEPLOY"
  ask    BRANCH_REMOTE "Git remote for branch deploys"        "$BRANCH_REMOTE"
  ask    LXC_REPO_PATH "LXC source repo path for branch deploys (blank = auto)" "$LXC_REPO_PATH"
  ask_yn LIST_BRANCHES "List available deploy branches?"      "$LIST_BRANCHES"
  if [ "$LIST_BRANCHES" = "1" ]; then
    ask_yn BRANCH_LIST_ONLY "Only list branches and exit?"    "$BRANCH_LIST_ONLY"
    show_remote_branches
    if [ "$BRANCH_LIST_ONLY" = "1" ]; then
      exit 0
    fi
  fi
  ask    DEPLOY_BRANCH "Branch number/ref to deploy (blank = current image/checkout)" "$DEPLOY_BRANCH"
  resolve_branch_selection "$DEPLOY_BRANCH"
  ask_yn REENABLE_MB  "Re-enable MusicBrainz on this run?"    "$REENABLE_MB"
  if [ "$REENABLE_MB" = "1" ]; then
    ask  SETTINGS_PATH "  settings.json path (blank = auto-discover)" "$SETTINGS_PATH"
  fi
  ask    EXPECTED_REV "Expected git revision SHA"             "$EXPECTED_REV"
  echo
fi

if [ "$LIST_BRANCHES" = "1" ] && [ "$BRANCHES_LISTED" = "0" ]; then
  show_remote_branches
  if [ "$BRANCH_LIST_ONLY" = "1" ]; then
    exit 0
  fi
fi

if [ -n "$DEPLOY_BRANCH" ]; then
  resolve_branch_selection "$DEPLOY_BRANCH"
fi

# ── API key required for auth-gated test paths ───────────────────
# The proxy uses simple x-api-key header auth; there is no separate
# session/login flow used by this harness. If API_KEY isn't set via
# env or the wizard, prompt once; if still empty, abort.
if [ -z "${API_KEY:-}" ] && [ -t 0 ] && [ "${INTERACTIVE:-1}" = "1" ]; then
  echo
  echo "No API key provided."
  read -rp "Enter API key: " API_KEY
fi

if [ -z "$API_KEY" ]; then
  echo "ERROR: API key is required"
  exit 1
fi

# ── Pass/fail tracking ───────────────────────────────────────────
PASSES=0
FAILS=0
declare -a PASS_LOG=()
declare -a FAIL_LOG=()

record_pass () {
  PASSES=$((PASSES + 1))
  PASS_LOG+=("$*")
  echo "  PASS: $*"
}
record_fail () {
  FAILS=$((FAILS + 1))
  FAIL_LOG+=("$*")
  echo "  FAIL: $*"
}

# Strip trailing CR/whitespace — curl's `head -1` keeps the `\r` from HTTP
# headers, which clobbers later `(...)` formatting on the same line.
chomp () {
  printf '%s' "$1" | tr -d '\r' | sed -e 's/[[:space:]]*$//'
}

# ── Remote curl helpers ──────────────────────────────────────────
# API_KEY is passed via env to the inner shell — never interpolated into
# a quoted string — so quotes/$ in the key won't break the command.
remote_get () {
  # Body only.  Usage: remote_get <path>
  pct exec "$CTID" -- env API_KEY="$API_KEY" BASE_URL="$BASE_URL" PATH_ARG="$1" bash -lc '
    if [ -n "$API_KEY" ]; then
      curl -s "$BASE_URL$PATH_ARG" -H "X-Api-Key: $API_KEY"
    else
      curl -s "$BASE_URL$PATH_ARG"
    fi
  '
}

remote_get_full () {
  # Headers + body.  Usage: remote_get_full <path>
  pct exec "$CTID" -- env API_KEY="$API_KEY" BASE_URL="$BASE_URL" PATH_ARG="$1" bash -lc '
    if [ -n "$API_KEY" ]; then
      curl -i -s "$BASE_URL$PATH_ARG" -H "X-Api-Key: $API_KEY"
    else
      curl -i -s "$BASE_URL$PATH_ARG"
    fi
  '
}

remote_status_line () {
  remote_get_full "$1" | head -1
}

remote_post () {
  pct exec "$CTID" -- env API_KEY="$API_KEY" BASE_URL="$BASE_URL" PATH_ARG="$1" bash -lc '
    if [ -n "$API_KEY" ]; then
      curl -s -X POST "$BASE_URL$PATH_ARG" -H "X-Api-Key: $API_KEY"
    else
      curl -s -X POST "$BASE_URL$PATH_ARG"
    fi
  '
}

echo "Melodarr verification harness"
echo "CTID=$CTID  BASE_URL=$BASE_URL  SKIP_DEPLOY=$SKIP_DEPLOY  DEPLOY_BRANCH=${DEPLOY_BRANCH:-<none>}"

# ── 1. Disk + deploy ─────────────────────────────────────────────
echo
echo "## Disk check"
pct exec "$CTID" -- bash -lc 'df -h /var/lib/docker 2>/dev/null; docker system df'

if [ "$SKIP_DEPLOY" = "0" ]; then
  echo
  echo "## Deploy proxy only"
  if [ -n "$DEPLOY_BRANCH" ]; then
    echo "Deploying branch/ref: $DEPLOY_BRANCH"
    DEPLOY_OK=0
    deploy_branch_ref && DEPLOY_OK=1
  else
    DEPLOY_OK=0
    pct exec "$CTID" -- bash -lc 'cd /opt/melodarr-proxy && docker compose pull proxy && docker compose up -d --force-recreate proxy' && DEPLOY_OK=1
  fi

  if [ "$DEPLOY_OK" = "1" ]; then
    DEPLOYED_REV="$(current_deploy_revision)"
    if [ -n "$DEPLOY_BRANCH" ] && [ -n "$DEPLOYED_REV" ] && [ -z "$EXPECTED_REV" ]; then
      EXPECTED_REV="$DEPLOYED_REV"
    fi
    record_pass "deploy succeeded${DEPLOYED_REV:+ (checkout revision=$DEPLOYED_REV)}"
    sleep 5
  else
    record_fail "deploy failed — aborting verification"
    echo
    echo "Re-run with SKIP_DEPLOY=1 to verify against the existing deployment."
    exit 1
  fi
else
  echo
  echo "## Deploy skipped (SKIP_DEPLOY=$SKIP_DEPLOY)"
fi

# ── 2. Version check ─────────────────────────────────────────────
echo
echo "## Version check"
VERSION_BODY=$(remote_get /api/version)
echo "$VERSION_BODY" | jq
ACTUAL_REV=$(echo "$VERSION_BODY" | jq -r '.revision // empty')
if [ -z "$EXPECTED_REV" ]; then
  record_pass "version endpoint responded (revision=$ACTUAL_REV)"
elif [ "$ACTUAL_REV" = "$EXPECTED_REV" ]; then
  record_pass "running expected revision $ACTUAL_REV"
else
  record_fail "expected revision=$EXPECTED_REV, got=$ACTUAL_REV — deploy did not land or you're on a different version"
fi

# ── 2.5. Optional: re-enable MusicBrainz (REENABLE_MB=1) ─────────
# Lidarr's data model is keyed on MB UUIDs. When MusicBrainz has been
# excluded from metadataProviders, this project intentionally does not
# synthesize fake IDs. That means foreignArtistId may be empty until
# MusicBrainz is reachable and active again.
# Setting REENABLE_MB=1 clears the saved runtime overrides under
# .runtime in settings.json and restarts the proxy.
#
# settings.json discovery: the file may be visible via a host bind-
# mount at /data/settings.json on the LXC, OR it may live only inside
# the container (when /data is a docker named volume).  We probe both
# and use docker cp for the round-trip when we can only see it inside.
#
# Optional override: SETTINGS_PATH=/your/path forces a specific file
# (must exist either on the LXC or inside the proxy container).
#
# We verify BEHAVIOR not just config — the action is considered
# successful when MB is in active providers, the settings file no longer
# shadows providers, and a real lookup populates foreignArtistId.
# /debug/upstream is useful diagnostics, but it is not part of Lidarr's
# contract and may be empty after restarts/cache paths.
if [ "$REENABLE_MB" = "1" ]; then
  echo
  echo "## Re-enable MusicBrainz (REENABLE_MB=1)"
  REENABLE_TS=$(date +%s)

  # ── Locate settings.json ────────────────────────────────────────
  SETTINGS_LOCATION=""
  CONTAINER_NAME="melodarr-proxy-proxy-1"
  CANDIDATE_PATHS=("${SETTINGS_PATH:-}" "/data/settings.json" "/opt/melodarr-proxy/data/settings.json" "/config/settings.json")

  echo "  Searching for settings.json..."
  for path in "${CANDIDATE_PATHS[@]}"; do
    [ -z "$path" ] && continue
    # Try inside the container first — that's the canonical location.
    if pct exec "$CTID" -- docker exec "$CONTAINER_NAME" test -f "$path" 2>/dev/null; then
      SETTINGS_LOCATION="container"
      SETTINGS_FILE="$path"
      echo "  ✓ Found at $CONTAINER_NAME:$path (container)"
      break
    fi
    # Fall back to LXC host (bind-mount case).
    if pct exec "$CTID" -- test -f "$path" 2>/dev/null; then
      SETTINGS_LOCATION="host"
      SETTINGS_FILE="$path"
      echo "  ✓ Found at $path (LXC host bind mount)"
      break
    fi
  done

  # If still not found, do a broader search and print candidates.
  if [ -z "$SETTINGS_LOCATION" ]; then
    echo "  Not at any known path — running find inside the container..."
    CANDIDATES=$(pct exec "$CTID" -- docker exec "$CONTAINER_NAME" find / -name 'settings.json' -not -path '*/node_modules/*' 2>/dev/null | head -10 || true)
    if [ -z "$CANDIDATES" ]; then
      echo "  Falling back to find on LXC host..."
      CANDIDATES=$(pct exec "$CTID" -- bash -lc "find / -name 'settings.json' -not -path '*/node_modules/*' 2>/dev/null | head -10" || true)
    fi
    if [ -n "$CANDIDATES" ]; then
      echo "  Candidates found (set SETTINGS_PATH=<path> and re-run):"
      echo "$CANDIDATES" | sed 's/^/    /'
    else
      echo "  No settings.json found anywhere."
    fi
    record_fail "MB re-enable: settings.json not found (set SETTINGS_PATH or check the container)"
  fi

  # ── Action: backup, clear overrides, restart ────────────────────
  if [ -n "$SETTINGS_LOCATION" ]; then
    if [ "$SETTINGS_LOCATION" = "container" ]; then
      EDIT_OK=0
      pct exec "$CTID" -- bash -lc "
set -e
docker exec '$CONTAINER_NAME' cp '$SETTINGS_FILE' '${SETTINGS_FILE}.bak.${REENABLE_TS}'
docker cp '$CONTAINER_NAME:$SETTINGS_FILE' /tmp/settings.${REENABLE_TS}.json
jq 'del(.runtime.metadataProviders, .runtime.providerPriority)' /tmp/settings.${REENABLE_TS}.json > /tmp/settings.${REENABLE_TS}.new
docker cp /tmp/settings.${REENABLE_TS}.new '$CONTAINER_NAME:$SETTINGS_FILE'
rm -f /tmp/settings.${REENABLE_TS}.json /tmp/settings.${REENABLE_TS}.new
cd /opt/melodarr-proxy && docker compose restart proxy > /dev/null
" && EDIT_OK=1 || true
    else
      EDIT_OK=0
      pct exec "$CTID" -- bash -lc "
set -e
cp '$SETTINGS_FILE' '${SETTINGS_FILE}.bak.${REENABLE_TS}'
jq 'del(.runtime.metadataProviders, .runtime.providerPriority)' '$SETTINGS_FILE' > /tmp/settings.${REENABLE_TS}.new
mv /tmp/settings.${REENABLE_TS}.new '$SETTINGS_FILE'
cd /opt/melodarr-proxy && docker compose restart proxy > /dev/null
" && EDIT_OK=1 || true
    fi

    if [ "$EDIT_OK" = "1" ]; then
      echo "  Backup: ${SETTINGS_FILE}.bak.${REENABLE_TS} (in $SETTINGS_LOCATION)"
      echo "  Proxy restarting; waiting 10s for it to come back up..."
      sleep 10
      remote_post /api/cache/clear > /dev/null 2>&1 || true
      echo "  Cache cleared, running PASS gates..."
    else
      record_fail "MB re-enable: settings.json edit or proxy restart failed (see ERROR above)"
    fi
  fi

  # ── PASS gate 1: /api/ready shows musicbrainz in active providers ──
  READY_AFTER=$(remote_get /api/ready)
  ACTIVE_AFTER=$(echo "$READY_AFTER" | jq -r '.upstreamDetail.activeProviders // [] | join(",")')
  echo "  Active providers now: $ACTIVE_AFTER"
  if echo ",$ACTIVE_AFTER," | grep -q ',musicbrainz,'; then
    record_pass "MB re-enable: /api/ready shows musicbrainz in active providers"
  else
    record_fail "MB re-enable: /api/ready does NOT show musicbrainz (got: $ACTIVE_AFTER)"
  fi

  # ── PASS gates 2 & 3: settings.json no longer shadows providers ──
  # Read from whichever location we discovered the file in.
  if [ "${SETTINGS_LOCATION:-}" = "container" ]; then
    SETTINGS_RAW=$(pct exec "$CTID" -- docker exec "$CONTAINER_NAME" cat "$SETTINGS_FILE" 2>/dev/null)
  elif [ "${SETTINGS_LOCATION:-}" = "host" ]; then
    SETTINGS_RAW=$(pct exec "$CTID" -- cat "$SETTINGS_FILE" 2>/dev/null)
  else
    # Fall back to a best-effort container read so the gates still produce
    # diagnostic output instead of crashing on an empty pipe.
    SETTINGS_RAW=$(pct exec "$CTID" -- docker exec melodarr-proxy-proxy-1 cat /data/settings.json 2>/dev/null || echo '{}')
  fi
  SETTINGS_RUNTIME=$(echo "$SETTINGS_RAW" \
    | jq '.runtime // {} | {metadataProviders: (.metadataProviders // null), providerPriority: (.providerPriority // null)}' 2>/dev/null \
    || echo '{"metadataProviders": "<unreadable>", "providerPriority": "<unreadable>"}')
  if echo "$SETTINGS_RUNTIME" | jq -e '.metadataProviders == null' > /dev/null 2>&1; then
    record_pass "MB re-enable: settings.json runtime.metadataProviders override cleared"
  else
    OFFENDER=$(echo "$SETTINGS_RUNTIME" | jq -r '.metadataProviders')
    record_fail "MB re-enable: settings.json runtime.metadataProviders still set to '$OFFENDER'"
  fi
  if echo "$SETTINGS_RUNTIME" | jq -e '.providerPriority == null' > /dev/null 2>&1; then
    record_pass "MB re-enable: settings.json runtime.providerPriority override cleared"
  else
    OFFENDER=$(echo "$SETTINGS_RUNTIME" | jq -r '.providerPriority')
    record_fail "MB re-enable: settings.json runtime.providerPriority still set to '$OFFENDER'"
  fi

  # ── PASS gate 4: lookup returns a non-empty foreignArtistId (MBID) ──
  # This verifies the merge sees MB. /debug/upstream is checked below as
  # diagnostics only; the Lidarr contract is the returned artist shape.
  LOOKUP_AFTER=$(remote_get '/api/v0.4/artist/lookup?term=radiohead')
  MBID_AFTER=$(echo "$LOOKUP_AFTER" | jq -r '.[0].foreignArtistId // ""')
  if [ -n "$MBID_AFTER" ] && [ "$MBID_AFTER" != "null" ]; then
    record_pass "MB re-enable: foreignArtistId populated ($MBID_AFTER)"
  else
    record_fail "MB re-enable: foreignArtistId still empty after re-enable"
  fi

  # ── Diagnostic gate 5: /debug/upstream shows MB activity from the lookup ──
  UPSTREAM_AFTER=$(remote_get '/debug/upstream?provider=musicbrainz&limit=20')
  UPSTREAM_COUNT=$(echo "$UPSTREAM_AFTER" | jq -r '.filteredCount // 0' 2>/dev/null)
  [ -z "$UPSTREAM_COUNT" ] && UPSTREAM_COUNT=0
  if [ "$UPSTREAM_COUNT" -gt 0 ] 2>/dev/null; then
    record_pass "MB re-enable: /debug/upstream shows musicbrainz activity (filteredCount=$UPSTREAM_COUNT)"
  elif [ -n "$MBID_AFTER" ] && [ "$MBID_AFTER" != "null" ]; then
    echo "  WARN: /debug/upstream has no musicbrainz entries, but lookup returned MBID=$MBID_AFTER"
    record_pass "MB re-enable: lookup returned MBID; /debug/upstream empty (diagnostic only)"
  else
    echo "  WARN: /debug/upstream has no musicbrainz entries; foreignArtistId gate above is authoritative"
    record_pass "MB re-enable: /debug/upstream empty (diagnostic only, filteredCount=$UPSTREAM_COUNT)"
  fi
fi

# ── 3. Cache clear (forces fresh aggregations for Lidarr-shape tests) ──
echo
echo "## Clearing cache (fresh Lidarr-shape tests)"
remote_post /api/cache/clear > /dev/null 2>&1 || true
echo "  (cache cleared)"

# ── 4. /api/search 502 regression ────────────────────────────────
echo
echo "## Search endpoint should not 502"
SEARCH_STATUS=$(chomp "$(remote_status_line '/api/search?type=all&query=junkyards')")
echo "$SEARCH_STATUS"
if echo "$SEARCH_STATUS" | grep -q ' 200'; then
  record_pass "/api/search returns 200"
else
  record_fail "/api/search status: $SEARCH_STATUS"
fi

echo
echo "## Search response summary"
remote_get '/api/search?type=all&query=junkyards' \
  | jq 'if type == "object" then {has_albums: (.albums // [] | length > 0), partial, warning} else {count: length} end'

# ── 5. /api/v1/artist/discover 502 regression ────────────────────
echo
echo "## Artist discover should not 502"
DISC_STATUS=$(chomp "$(remote_status_line '/api/v1/artist/discover?q=junkyards')")
echo "$DISC_STATUS"
if echo "$DISC_STATUS" | grep -q ' 200'; then
  record_pass "/api/v1/artist/discover returns 200"
else
  record_fail "/api/v1/artist/discover status: $DISC_STATUS"
fi

echo
echo "## Artist discover response summary"
remote_get '/api/v1/artist/discover?q=junkyards' \
  | jq '{providers, partial, warning, candidate_count: (.candidates // [] | length)}'

# ── 5b. SkyHook search-shape conformance (v0.3.37) ───────────────
# Lidarr's SkyHook deserializer requires every search-result item to be
# wrapped as {"artist":{...}} or {"album":{...}}. A flat candidate object
# slips past the 200-status check above but breaks Lidarr with "Invalid
# response received from LidarrAPI" — verified by the fact that this exact
# error blocked artist-add for an entire release cycle.
#
# v0.3.38: query rotates daily via testArtists.getNextArtist() so the
# harness exercises a different artist's data path each day, surfacing
# provider-specific failures that a single-artist test would miss.
echo
echo "## SkyHook search-shape conformance"
SHAPE_QUERY=$(node -e "console.log(require('./src/utils/testArtists').getNextArtist())" 2>/dev/null || echo "Radiohead")
echo "Testing artist: $SHAPE_QUERY"
# URL-encode spaces in the artist name (some pool entries are multi-word).
SHAPE_QUERY_ENC=$(echo "$SHAPE_QUERY" | sed 's/ /%20/g')
SHAPE_BODY=$(remote_get "/api/search?type=all&query=$SHAPE_QUERY_ENC")
SHAPE_REPORT=$(echo "$SHAPE_BODY" | jq '
  if type == "array" then
    {
      total:   length,
      wrapped: ([.[] | select(.artist or .album)] | length),
      invalid: ([.[] | select((.artist|not) and (.album|not))] | length)
    }
  else
    { total: 0, wrapped: 0, invalid: -1, error: "response is not a JSON array" }
  end')
echo "$SHAPE_REPORT"

SHAPE_TOTAL=$(echo "$SHAPE_REPORT"   | jq -r '.total')
SHAPE_WRAPPED=$(echo "$SHAPE_REPORT" | jq -r '.wrapped')
SHAPE_INVALID=$(echo "$SHAPE_REPORT" | jq -r '.invalid')

# Three independent checks so failure mode is unambiguous in the summary:
# (a) candidates exist at all, (b) every item is wrapped, (c) no flat leak.
if [ "$SHAPE_TOTAL" -gt 0 ] 2>/dev/null; then
  record_pass "/api/search returned $SHAPE_TOTAL candidates for $SHAPE_QUERY"
else
  record_fail "/api/search returned 0 candidates for $SHAPE_QUERY — cannot validate wrap"
fi

if [ "$SHAPE_TOTAL" -gt 0 ] 2>/dev/null && [ "$SHAPE_WRAPPED" = "$SHAPE_TOTAL" ]; then
  record_pass "/api/search every item is SkyHook-wrapped (wrapped=$SHAPE_WRAPPED of $SHAPE_TOTAL)"
elif [ "$SHAPE_TOTAL" -gt 0 ] 2>/dev/null; then
  record_fail "/api/search wrap incomplete — wrapped=$SHAPE_WRAPPED of $SHAPE_TOTAL (some items dropped)"
fi

if [ "$SHAPE_INVALID" = "0" ]; then
  record_pass "/api/search no flat objects leaked through (invalid=0)"
else
  record_fail "/api/search has $SHAPE_INVALID flat objects without artist/album wrapper — Lidarr will reject"
fi

# Defensive per-item probe — guards against the aggregate looking right
# while the first element is malformed (e.g. wrapper key present but null).
FIRST_HAS_WRAPPER=$(echo "$SHAPE_BODY" | jq -r '.[0] | (has("artist") or has("album")) // false' 2>/dev/null)
if [ "$FIRST_HAS_WRAPPER" = "true" ]; then
  record_pass "/api/search first item has .artist or .album key"
else
  record_fail "/api/search first item missing wrapper key (got: $FIRST_HAS_WRAPPER)"
fi

# ── 6. Negative path ─────────────────────────────────────────────
echo
echo "## Negative search (garbage query → 200, never 5xx)"
NEG_STATUS=$(chomp "$(remote_status_line '/api/search?query=zzzzzzz_no_such_artist_xyz_98765')")
echo "$NEG_STATUS"
if echo "$NEG_STATUS" | grep -qE '^HTTP/[0-9.]+ (200|404)'; then
  record_pass "garbage query handled gracefully ($NEG_STATUS)"
else
  record_fail "garbage query returned non-2xx/404: $NEG_STATUS"
fi

# ── 7. PII / config-leak check ───────────────────────────────────
echo
echo "## PII/config leak check"
LEAK_FOUND=0
for path in "/api/search?type=all&query=junkyards" "/api/v1/artist/discover?q=junkyards"; do
  echo "=== $path ==="
  body=$(remote_get "$path")
  path_leak=0
  for needle in "jcwalker3" "yahoo.com" "musicbrainz.org" "Lunar Bridge" "User-Agent" '"fmt"' '"limit"'; do
    if echo "$body" | grep -qi "$needle"; then
      echo "  LEAK: response contains: $needle"
      path_leak=1
      LEAK_FOUND=1
    fi
  done
  [ "$path_leak" = 0 ] && echo "  CLEAN: no PII or upstream-config strings found"
done
if [ "$LEAK_FOUND" = 0 ]; then
  record_pass "no PII or upstream config in error bodies"
else
  record_fail "PII/config leak detected — see LEAK lines above"
fi

# ── 8. Ready / provider status ───────────────────────────────────
echo
echo "## Ready/provider status"
READY_BODY=$(remote_get /api/ready)
echo "$READY_BODY" | jq '{upstream, probedProvider: .upstreamDetail.probedProvider, activeProviders: .upstreamDetail.activeProviders}'
ACTIVE_PROVIDERS=$(echo "$READY_BODY" | jq -r '.upstreamDetail.activeProviders // [] | join(",")')
MB_ACTIVE=$(echo "$READY_BODY" | jq -r '.upstreamDetail.activeProviders // [] | index("musicbrainz") // empty')

echo
echo "## Runtime MusicBrainz network preference"
MB_FAMILY=$(pct exec "$CTID" -- docker exec melodarr-proxy-proxy-1 printenv MUSICBRAINZ_IP_FAMILY 2>/dev/null || true)
if [ "$MB_FAMILY" = "6" ]; then
  record_pass "MUSICBRAINZ_IP_FAMILY=6"
else
  record_fail "MUSICBRAINZ_IP_FAMILY is '${MB_FAMILY:-unset}', expected 6 for current IPv6-first deployment"
fi

# ── 9. Upstream buffer (gated on MB being active) ────────────────
echo
echo "## Upstream buffer provider counts"
if [ -n "$MB_ACTIVE" ]; then
  remote_get '/debug/upstream?limit=20' \
    | jq '[.entries[].provider] | group_by(.) | map({provider: .[0], count: length})'
else
  echo "  (skipped — musicbrainz not in activeProviders=[$ACTIVE_PROVIDERS]; buffer only records MB attempts)"
fi

# ── 10. Lidarr-compatible artist lookup endpoints ────────────────
echo
echo "## Lidarr-compatible artist lookup endpoints"

echo
echo "### /api/v1/artist/lookup raw response (first 100 lines)"
remote_get_full '/api/v1/artist/lookup?term=Radiohead' | head -100

echo
echo "### /api/v0.4/artist/lookup raw response (first 100 lines)"
remote_get_full '/api/v0.4/artist/lookup?term=Radiohead' | head -100

echo
echo "### Legacy public compat route: /artist/search"
LEGACY_SEARCH_STATUS=$(chomp "$(remote_status_line '/artist/search?term=Radiohead')")
echo "$LEGACY_SEARCH_STATUS"
if echo "$LEGACY_SEARCH_STATUS" | grep -q ' 200'; then
  record_pass "/artist/search compatibility route returns 200"
else
  record_fail "/artist/search compatibility route status: $LEGACY_SEARCH_STATUS"
fi

# Path-key auth form — Lidarr's C# URI builder strips query params, so it
# uses /api/<key>/v1/artist/lookup instead of header auth.  Test it
# explicitly so we catch path-key middleware regressions.
echo
echo "### Path-key auth form: /api/<key>/v1/artist/lookup"
if [ -n "$API_KEY" ]; then
  PATH_KEY_STATUS=$(chomp "$(pct exec "$CTID" -- env API_KEY="$API_KEY" BASE_URL="$BASE_URL" bash -lc '
    curl -i -s "$BASE_URL/api/$API_KEY/v1/artist/lookup?term=Radiohead" | head -1
  ')")
  echo "$PATH_KEY_STATUS"
  if echo "$PATH_KEY_STATUS" | grep -q ' 200'; then
    record_pass "path-key auth form returns 200"
  else
    record_fail "/api/<key>/v1/artist/lookup status: $PATH_KEY_STATUS"
  fi
else
  echo "  (skipped — API_KEY not set)"
fi

echo
echo "### Lidarr path-segment route diagnostics"
RADIOHEAD_MBID="a74b1b7f-71a5-4011-9441-d0b5e4122711"
ARTIST_SEGMENT_PATH="/api/v0.4/artist/$RADIOHEAD_MBID"
ARTIST_SEGMENT_STATUS=$(chomp "$(remote_status_line "$ARTIST_SEGMENT_PATH")")
RECENT_ARTIST_STATUS=$(chomp "$(remote_status_line '/api/v0.4/recent/artist?since=2026-01-01T00:00:00Z')")
RECENT_ALBUM_STATUS=$(chomp "$(remote_status_line '/api/v0.4/recent/album?since=2026-01-01T00:00:00Z')")
echo "artist/:mbid:  $ARTIST_SEGMENT_STATUS"
echo "recent/artist: $RECENT_ARTIST_STATUS"
echo "recent/album:  $RECENT_ALBUM_STATUS"
if echo "$ARTIST_SEGMENT_STATUS" | grep -q ' 200'; then
  record_pass "/api/v0.4/artist/<mbid> returns 200"
else
  record_fail "/api/v0.4/artist/<mbid> status: $ARTIST_SEGMENT_STATUS"
fi
if echo "$RECENT_ARTIST_STATUS" | grep -q ' 200'; then
  record_pass "/api/v0.4/recent/artist returns 200"
else
  record_fail "/api/v0.4/recent/artist status: $RECENT_ARTIST_STATUS"
fi
if echo "$RECENT_ALBUM_STATUS" | grep -q ' 200'; then
  record_pass "/api/v0.4/recent/album returns 200"
else
  record_fail "/api/v0.4/recent/album status: $RECENT_ALBUM_STATUS"
fi

echo
echo "### Validate /api/v0.4/artist/<mbid> album metadata contract"
ARTIST_SEGMENT_BODY=$(remote_get "$ARTIST_SEGMENT_PATH")
ARTIST_ALBUM_SUMMARY=$(echo "$ARTIST_SEGMENT_BODY" | jq '
  {
    artistName: (.artistName // null),
    foreignArtistId: (.foreignArtistId // null),
    albumCount: (.albums // [] | length),
    firstAlbum: ((.albums // [])[0] // {}),
    firstAlbumId: (((.albums // [])[0] // {}).id // ""),
    firstAlbumTitle: (((.albums // [])[0] // {}).title // ""),
    firstAlbumType: (((.albums // [])[0] // {}).type // ""),
    firstAlbumSecondaryTypes: (((.albums // [])[0] // {}).secondaryTypes // null),
    firstAlbumReleaseStatuses: (((.albums // [])[0] // {}).releaseStatuses // null)
  }
' 2>/dev/null || echo '{}')
echo "$ARTIST_ALBUM_SUMMARY" | jq

if echo "$ARTIST_ALBUM_SUMMARY" | jq -e '.albumCount > 0' > /dev/null; then
  ALBUM_COUNT=$(echo "$ARTIST_ALBUM_SUMMARY" | jq -r '.albumCount')
  record_pass "/api/v0.4/artist/<mbid> includes albums (count=$ALBUM_COUNT)"
else
  record_fail "/api/v0.4/artist/<mbid> includes no albums - Lidarr artist page will show missing-albums metadata message"
fi

FIRST_ALBUM_ID=$(echo "$ARTIST_ALBUM_SUMMARY" | jq -r '.firstAlbumId // ""')

if echo "$ARTIST_ALBUM_SUMMARY" | jq -e '.firstAlbumId != "" and .firstAlbumTitle != ""' > /dev/null; then
  record_pass "artist metadata first album has id and title"
else
  record_fail "artist metadata first album is missing id/title - Lidarr cannot persist a usable album row"
fi

if echo "$ARTIST_ALBUM_SUMMARY" | jq -e '
  .firstAlbumType == "Album" and
  (.firstAlbumSecondaryTypes | type == "array") and
  (.firstAlbumReleaseStatuses | type == "array") and
  (.firstAlbumReleaseStatuses | index("Official") != null)
' > /dev/null; then
  record_pass "artist metadata first album passes Lidarr default metadata-profile filters"
else
  record_fail "artist metadata first album does not match Lidarr default metadata-profile filters"
fi

if [[ -n "$FIRST_ALBUM_ID" ]]; then
  ALBUM_SEGMENT_PATH="/api/v0.4/album/$FIRST_ALBUM_ID"
  ALBUM_SEGMENT_HEADERS=$(remote_get_full "$ALBUM_SEGMENT_PATH" | sed -n '1,60p')
  ALBUM_SEGMENT_STATUS=$(echo "$ALBUM_SEGMENT_HEADERS" | head -1 | tr -d '\r')
  echo "album/:releaseGroupId: $ALBUM_SEGMENT_STATUS"
  if [[ "$ALBUM_SEGMENT_STATUS" =~ 200 ]]; then
    record_pass "/api/v0.4/album/<releaseGroupId> returns album metadata"
  else
    echo "$ALBUM_SEGMENT_HEADERS"
    record_fail "/api/v0.4/album/<releaseGroupId> status: $ALBUM_SEGMENT_STATUS"
  fi

  ALBUM_SEGMENT_BODY=$(remote_get "$ALBUM_SEGMENT_PATH")
  ALBUM_RELEASE_SUMMARY=$(echo "$ALBUM_SEGMENT_BODY" | jq '
    {
      releaseCount: (.releases // [] | length),
      firstReleaseTrackCount: (((.releases // [])[0] // {}).tracks // [] | length)
    }
  ' 2>/dev/null || echo '{}')
  echo "$ALBUM_RELEASE_SUMMARY" | jq
  if echo "$ALBUM_RELEASE_SUMMARY" | jq -e '.releaseCount > 0 and .firstReleaseTrackCount > 0' > /dev/null; then
    record_pass "/api/v0.4/album/<releaseGroupId> includes release and track metadata"
  else
    record_fail "/api/v0.4/album/<releaseGroupId> missing release/track metadata - Lidarr deletes albums with zero valid releases"
  fi

  ALBUM_SEGMENT_CACHE_HEADERS=$(remote_get_full "$ALBUM_SEGMENT_PATH" | sed -n '1,60p')
  if echo "$ALBUM_SEGMENT_CACHE_HEADERS" | grep -qi '^X-Cache: HIT'; then
    record_pass "/api/v0.4/album/<releaseGroupId> repeated metadata fetch is served from cache"
  else
    echo "$ALBUM_SEGMENT_CACHE_HEADERS"
    record_fail "/api/v0.4/album/<releaseGroupId> repeated metadata fetch did not return X-Cache: HIT"
  fi
else
  record_fail "/api/v0.4/album/<releaseGroupId> cannot be tested because artist metadata had no first album id"
fi

ARTIST_SEGMENT_CACHE_HEADERS=$(remote_get_full "$ARTIST_SEGMENT_PATH" | sed -n '1,40p')
if echo "$ARTIST_SEGMENT_CACHE_HEADERS" | grep -qi '^X-Cache: HIT'; then
  record_pass "/api/v0.4/artist/<mbid> repeated metadata fetch is served from cache"
else
  echo "$ARTIST_SEGMENT_CACHE_HEADERS"
  record_fail "/api/v0.4/artist/<mbid> repeated metadata fetch did not return X-Cache: HIT"
fi

# ── 11. Lidarr/Skyhook shape conformance ─────────────────────────
echo
echo "### Validate /api/v1/artist/lookup Skyhook shape"
LOOKUP_BODY=$(remote_get '/api/v1/artist/lookup?term=Radiohead')

LOOKUP_SUMMARY=$(echo "$LOOKUP_BODY" | jq '
  if type == "array" then
    {
      ok: true,
      count: length,
      firstArtistName: (.[0].artistName // null),
      foreignArtistId: (.[0].foreignArtistId // null),
      foreignArtistIdEmpty: ((.[0].foreignArtistId // "") == ""),
      hasAlbums: (.[0] | has("albums")),
      albumCount: (.[0].albums // [] | length),
      providers: (.[0].providers // []),
      hasImages: (.[0] | has("images")),
      hasGenres: (.[0] | has("genres")),
      hasOverview: (.[0] | has("overview")),
      hasDisambiguation: (.[0] | has("disambiguation")),
      hasOldIds: (.[0] | has("oldIds")),
      hasAliases: (.[0] | has("aliases")),
      hasArtistAliases: (.[0] | has("artistAliases")),
      hasLinks: (.[0] | has("links")),
      hasPopularity: (.[0] | has("popularity")),
      hasStatus: (.[0] | has("status")),
      hasTags: (.[0] | has("tags")),
      firstAlbumDate: (.[0].albums[0].firstReleaseDate // null),
      firstAlbumDateIsoLike: ((.[0].albums[0].firstReleaseDate // "") | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}"))
    }
  else
    { ok: false, type: type, body: . }
  end
')
echo "$LOOKUP_SUMMARY" | jq

if echo "$LOOKUP_SUMMARY" | jq -e '.ok' > /dev/null; then
  record_pass "/api/v1/artist/lookup returns array"
else
  record_fail "/api/v1/artist/lookup did not return array — body shape regression"
fi

if echo "$LOOKUP_SUMMARY" | jq -e '.foreignArtistIdEmpty == false' > /dev/null; then
  record_pass "foreignArtistId is populated (MBID)"
else
  record_fail "foreignArtistId is unexpectedly empty — Lidarr will reject this artist"
fi

if echo "$LOOKUP_SUMMARY" | jq -e '.firstAlbumDateIsoLike' > /dev/null; then
  record_pass "firstReleaseDate is ISO 8601-like (YYYY-MM-DD…)"
else
  ACTUAL_DATE=$(echo "$LOOKUP_SUMMARY" | jq -r '.firstAlbumDate')
  record_fail "firstReleaseDate is not ISO 8601 (got: $ACTUAL_DATE) — Lidarr's date parser may reject"
fi

# SkyHook field presence. Only fields proven necessary should fail the
# harness. Optional enrichment fields are printed as diagnostics below so
# they can be correlated with real Lidarr rejection logs before code adds
# broad defaults.
for field_check in hasOldIds:oldIds hasAliases:aliases hasArtistAliases:artistAliases hasLinks:links hasStatus:status; do
  field_key="${field_check%%:*}"
  field_label="${field_check##*:}"
  if echo "$LOOKUP_SUMMARY" | jq -e ".$field_key" > /dev/null; then
    record_pass "Skyhook field present: $field_label"
  else
    record_fail "Skyhook field missing: $field_label"
  fi
done

echo
echo "### Optional lookup field diagnostics"
echo "$LOOKUP_SUMMARY" | jq '{hasImages, hasGenres, hasOverview, hasDisambiguation, hasPopularity, hasTags}'

# ── 12. Recent error logs (boot noise filtered) ──────────────────
echo
echo "### Recent proxy logs (filtered for radiohead/junkyards/errors)"
pct exec "$CTID" -- docker logs --tail 200 melodarr-proxy-proxy-1 2>&1 \
  | grep -iE 'radiohead|junkyards|/api/v1/artist|/api/search|invalid|error' \
  | grep -viE 'shadowing env variable|Redis cache is not connected|Upstream not healthy at boot' \
  | tail -30 || true

# ── 13. Final summary ────────────────────────────────────────────
echo
echo "========================================"
echo "Verification summary"
echo "  Revision:         $ACTUAL_REV"
echo "  Deploy branch:    ${DEPLOY_BRANCH:-<none>}"
echo "  Active providers: $ACTIVE_PROVIDERS"
echo "  Tests passed:     $PASSES"
echo "  Tests failed:     $FAILS"
if [ "$PASSES" -gt 0 ]; then
  echo
  echo "Passed:"
  for p in "${PASS_LOG[@]}"; do
    echo "  ✓ $p"
  done
fi
if [ "$FAILS" -gt 0 ]; then
  echo
  echo "Failed:"
  for f in "${FAIL_LOG[@]}"; do
    echo "  ✗ $f"
  done
fi
echo "========================================"

[ "$FAILS" -gt 0 ] && exit 1
exit 0

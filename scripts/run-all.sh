#!/usr/bin/env bash
#
# run-all.sh — interactive runner for Melodarr operational scripts.
#
# Provides a menu to invoke individual scripts or all tests in sequence.
# Tracks PASS/FAIL counts and prints a summary after batch runs and on
# exit. Deploy and rollback are treated as "actions" (not tracked in
# counters); only the test scripts contribute to PASS/FAIL.
#
# Env:
#   API_KEY   forwarded to child scripts via env inheritance.
#             post-deploy-check.sh and chaos-test.sh both fail fast
#             without it. Set once before running.

set -uo pipefail

# Resolve project root (parent of scripts/) so child scripts that use
# `node -e require('./src/...')` for the rotating-artist pool find it.
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BASE_DIR"

SCRIPTS=(
  "post-deploy-check.sh"
  "chaos-test.sh"
)

DEPLOY_SCRIPT="deploy-safe.sh"
ROLLBACK_SCRIPT="rollback.sh"

PASS=0
FAIL=0
LAST_RESULTS=()

run_script () {
  local script="$1"
  echo
  echo "----------------------------------------"
  echo "Running: $script"
  echo "----------------------------------------"

  # Subshell with explicit env so a failing child does not propagate
  # set -e to the runner. We only fail-the-runner on Ctrl+C / SIGTERM.
  if "./scripts/$script"; then
    echo "✓ $script PASSED"
    PASS=$((PASS + 1))
    LAST_RESULTS+=("✓ $script")
  else
    local rc=$?
    echo "✗ $script FAILED (exit $rc)"
    FAIL=$((FAIL + 1))
    LAST_RESULTS+=("✗ $script (exit $rc)")
  fi
}

run_all () {
  LAST_RESULTS=()
  for s in "${SCRIPTS[@]}"; do
    run_script "$s"
  done
  echo
  print_summary "Batch results"
}

print_summary () {
  local title="${1:-Cumulative results}"
  echo "========================================"
  echo "$title"
  echo "========================================"
  echo "  Passed: $PASS"
  echo "  Failed: $FAIL"
  if [ ${#LAST_RESULTS[@]} -gt 0 ]; then
    echo
    echo "Last run:"
    for line in "${LAST_RESULTS[@]}"; do
      echo "  $line"
    done
  fi
  echo "========================================"
}

# Print summary on any clean exit (including option 6).
trap 'print_summary "Final tally"' EXIT

menu () {
  echo
  echo "========================================"
  echo "Melodarr Script Runner    (pass=$PASS fail=$FAIL)"
  echo "========================================"
  echo "1) Run post-deploy checks"
  echo "2) Run chaos test"
  echo "3) Run ALL tests"
  echo "4) Deploy (safe)"
  echo "5) Rollback"
  echo "6) Exit"
  echo
  read -rp "Select option: " choice

  case "$choice" in
    1) run_script "post-deploy-check.sh" ;;
    2) run_script "chaos-test.sh" ;;
    3) run_all ;;
    4)
      echo
      echo "----------------------------------------"
      echo "Running: $DEPLOY_SCRIPT (action — not counted in PASS/FAIL)"
      echo "----------------------------------------"
      "./scripts/$DEPLOY_SCRIPT" || echo "✗ deploy exited non-zero"
      ;;
    5)
      echo
      echo "----------------------------------------"
      echo "Running: $ROLLBACK_SCRIPT (action — not counted in PASS/FAIL)"
      echo "----------------------------------------"
      "./scripts/$ROLLBACK_SCRIPT" || echo "✗ rollback exited non-zero"
      ;;
    6) exit 0 ;;
    *) echo "Invalid option" ;;
  esac
}

while true; do
  menu
done

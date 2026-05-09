#!/bin/bash
set -e

echo "Starting Docker-based E2E Tests..."
compose() {
  bash scripts/docker-compose-run.sh "$@"
}

compose -f docker-compose.e2e.yml up -d redis

# Run tests
compose -f docker-compose.e2e.yml run --rm e2e-tests

echo "Simulating Redis failure..."
compose -f docker-compose.e2e.yml stop redis

# Wait for proxy to detect failure
sleep 2

echo "Running tests after Redis failure..."
compose -f docker-compose.e2e.yml run --rm e2e-tests

echo "Cleaning up..."
compose -f docker-compose.e2e.yml down -v

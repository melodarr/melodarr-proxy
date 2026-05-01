#!/bin/bash
set -e

echo "Starting Docker-based E2E Tests..."
docker compose -f docker-compose.e2e.yml up -d redis || docker-compose -f docker-compose.e2e.yml up -d redis

# Run tests
docker compose -f docker-compose.e2e.yml run --rm e2e-tests || docker-compose -f docker-compose.e2e.yml run --rm e2e-tests

echo "Simulating Redis failure..."
docker compose -f docker-compose.e2e.yml stop redis || docker-compose -f docker-compose.e2e.yml stop redis

# Wait for proxy to detect failure
sleep 2

echo "Running tests after Redis failure..."
docker compose -f docker-compose.e2e.yml run --rm e2e-tests || docker-compose -f docker-compose.e2e.yml run --rm e2e-tests

echo "Cleaning up..."
docker compose -f docker-compose.e2e.yml down -v || docker-compose -f docker-compose.e2e.yml down -v

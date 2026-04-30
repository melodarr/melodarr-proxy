#!/bin/bash
set -e

echo "Starting Docker-based E2E Tests..."
docker-compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e-tests

# AI Quality Gates

These gates are merge blockers when the touched area applies.

## Required Merge Blockers

- `yarn lint`
- `yarn test`
- `yarn test:coverage:check`
- `yarn run lint` in `melodash`
- `docker compose build proxy`
- `docker compose build melodash`
- `scripts/docker-compose-smoke.sh`

## Focused Additions

Add `yarn test:contracts` when a change touches Lidarr/SkyHook contracts,
fixtures, provider normalization, or response shape.

Add `yarn test:compose` when a change touches Docker Compose, install scripts,
networking, ports, volumes, health checks, or runtime environment handling.

Add `yarn test:melodash-routes` when a change touches Melodash routing,
navigation, route handlers, or public page behavior.

## Guardrails

- Do not treat coverage as a replacement for contract correctness.
- Do not fabricate Lidarr runtime state to make tests pass.
- Do not skip Docker validation for install or release-flow changes.
- Keep verification scoped, but include every contract and runtime gate that
  protects the changed surface.

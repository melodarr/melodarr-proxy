# Testing Guide

This document describes the automated test gates and the manual smoke checks used for Melodarr Proxy and Melodash.

## Automated Gates

Run the proxy unit, controller, contract, and e2e tests:

```bash
yarn test
```

Run only unit-style tests:

```bash
yarn test:unit
```

Run only Lidarr/SkyHook contract tests:

```bash
yarn test:contracts
```

Run the mocked API e2e tests:

```bash
yarn test:e2e
```

Run real-upstream e2e tests:

```bash
yarn test:e2e:real
```

Run opt-in real provider integration tests:

```bash
REAL_PROVIDER_PROVIDERS=musicbrainz,itunes yarn test:providers:real
```

Run the full Docker Compose smoke gate:

```bash
yarn test:compose
```

Run only the Melodash route smoke gate against an already-running dashboard:

```bash
yarn test:melodash-routes
```

## CI Gates

GitHub Actions runs:

- proxy lint
- proxy test suite
- Melodash typecheck
- Docker image builds
- Docker Compose smoke test
- Melodash route smoke test through the Compose smoke script

The real provider integration workflow is separate from PR CI. It runs on a nightly schedule and can also be started manually from GitHub Actions.

## Contract Fixtures

Golden Lidarr/SkyHook fixtures live in:

```text
src/fixtures/lidarr/
```

Current fixtures:

- `skyhook-search.golden.json`
- `artist-lookup.golden.json`

The contract tests assert that search responses remain wrapped as SkyHook discriminated unions:

```json
[
  { "artist": { "artistName": "Radiohead" } },
  { "album": { "title": "OK Computer" } }
]
```

Flat search items are intentionally rejected by the contract tests because Lidarr can surface those as:

```text
Invalid response received from LidarrAPI
```

## Docker Compose Smoke Test

The Compose smoke script:

```bash
scripts/docker-compose-smoke.sh
```

It verifies:

- proxy container builds and starts
- Redis starts
- Melodash builds and starts
- `/api/health`
- `/api/ready`
- `/openapi.json`
- `/docs`
- Melodash `/dashboard`
- Melodash route coverage via `scripts/melodash-route-smoke.sh`

Useful overrides:

```bash
HOST_PORT=3055 MELODASH_HOST_PORT=55026 scripts/docker-compose-smoke.sh
```

## Melodash Route Smoke Test

The route smoke script:

```bash
scripts/melodash-route-smoke.sh
```

Default target:

```text
http://127.0.0.1:55026
```

Override:

```bash
MELODASH_BASE_URL=https://melodash.example.com scripts/melodash-route-smoke.sh
```

Routes checked:

- `/`
- `/dashboard`
- `/settings`
- `/explorer`
- `/requests`
- `/analytics`
- `/insights`
- `/updates`
- `/service/melodarr-proxy`
- `/docs`
- `/openapi.json`

## Provider Recovery Tests

Provider recovery behavior is covered in:

```text
src/health/providerHealth.test.js
```

The tests assert:

- providers disable after the configured failure threshold
- canary attempts only happen after cooldown
- one canary success does not immediately restore a disabled provider
- reenable requires a success streak inside the configured window
- failures interrupt the success streak
- reenabled providers return as `degraded`, not `healthy`
- failures after reenable disable the provider again
- logs and alerts do not spam during sustained outages

## Real Provider Integration Tests

Live provider tests live in:

```text
src/integration/real-provider.integration.test.js
```

They are skipped by default, including during normal `yarn test`, unless this gate is enabled:

```bash
REAL_PROVIDER_INTEGRATION=true
```

Manual examples:

```bash
REAL_PROVIDER_PROVIDERS=musicbrainz,itunes yarn test:providers:real
REAL_PROVIDER_PROVIDERS=discogs DISCOGS_TOKEN=... yarn test:providers:real
REAL_PROVIDER_PROVIDERS=theaudiodb THEAUDIODB_API_KEY=... yarn test:providers:real
REAL_PROVIDER_PROVIDERS=lastfm LASTFM_API_KEY=... yarn test:providers:real
```

Useful options:

```bash
REAL_PROVIDER_ARTIST=Radiohead
REAL_PROVIDER_MIN_ALBUMS=1
REAL_PROVIDER_AGGREGATE=true
```

Credential requirements:

- `musicbrainz` can run without `MUSICBRAINZ_API_KEY`, but the key is passed through when present.
- `itunes` does not require credentials.
- `discogs` requires `DISCOGS_TOKEN`.
- `lastfm` requires `LASTFM_API_KEY`.
- `theaudiodb` requires `THEAUDIODB_API_KEY`.

These tests are intentionally not required for pull requests because they depend on public upstream availability, provider credentials, rate limits, DNS, and Docker/LXC networking. They are intended for nightly validation, release checks, and manual diagnostics when provider behavior changes.

## Manual Health Checks

```bash
curl -s http://localhost:3055/api/health
curl -s http://localhost:3055/api/ready
curl -s http://localhost:3055/api/version
```

If Redis fails, `/api/ready` can show degraded while `/api/health` remains ok.

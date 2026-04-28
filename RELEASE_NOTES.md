# Melodarr Proxy v0.1.1

Patch release focused on open-source hardening, install documentation, and regression coverage after the initial `v0.1.0` release.

## Highlights

- Added `scripts/install-proxmox-lxc.sh` for Proxmox LXC installs.
- Added Lidarr setup documentation.
- Protected `main` with required CI checks.
- Tuned Dependabot to avoid unplanned major Node Docker and Express upgrades.
- Pinned optional service dependencies and added Yarn lockfiles.
- Added immutable Yarn installs for optional service Docker builds.
- Tightened Docker build contexts.
- Added tests for artist lookup cache behavior, response shape, provider failure handling, and API-key middleware.

## Compatibility

This release is not a full Lidarr metadata-server replacement. Current support is focused on:

- `GET /api/v1/artist/lookup?term={artist}`
- album-level normalized metadata
- cached repeated lookup behavior

Known gaps are tracked in `docs/lidarr-compatibility.md` and `ROADMAP.md`.

## Verification

Release checks run locally:

- `yarn lint`
- `yarn lint:auth`
- `yarn lint:devdash`
- `yarn test`
- `docker compose config --quiet`
- `docker compose build auth`
- `docker compose build devdash`
- `docker compose --profile test build test`

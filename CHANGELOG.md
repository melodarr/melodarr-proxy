# Changelog

All notable changes to Melodarr Proxy will be documented here.

## v0.1.1 - 2026-04-28

- Added Proxmox LXC installer script and streamlined README usage docs.
- Added Lidarr setup guide and linked it from compatibility documentation.
- Protected `main` with required PR checks.
- Tuned Dependabot to avoid unplanned major Node Docker and Express upgrades.
- Pinned optional service dependencies and added Yarn lockfiles.
- Added immutable Yarn installs for optional service Docker builds.
- Tightened Docker build contexts for root and optional services.
- Added integration coverage for artist lookup cache behavior, response shape, provider failure handling, and API-key middleware.

## v0.1.0 - 2026-04-28

- Added multi-provider metadata support.
- Added provider visibility to lookup responses and stats.
- Added Yarn-based development workflow.
- Added CI for lint, tests, and Docker builds.
- Added Docker health checks and Compose profiles for optional services.
- Added provider checkbox controls on the Settings page.
- Added API and Lidarr compatibility documentation.
- Added Dependabot configuration and Docker build context cleanup.
- Hardened the production container to run as a non-root user.
- Replaced personal SSH deployment with a GHCR image publishing workflow.

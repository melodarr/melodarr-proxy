# Changelog

All notable changes to Melodarr Proxy will be documented here.

## v0.3.1 - 2026-04-28

- Fixed Proxmox LXC installer to list templates already on the chosen storage and let the operator pick one, falling back to `pveam available` when none are present locally. `TEMPLATE_FILE` env override is preserved for unattended runs; non-TTY runs without an override now exit with a clear error.

## v0.3.0 - 2026-04-29

- Added Scalar API documentation at `/docs` backed by `/openapi.json`.
- Split responsibilities so the proxy exposes API/docs only and DevDash owns the operator UI.
- Added an Updates page in DevDash with release status, changelog display, and a guarded update action.
- Added proxy update status and apply endpoints with GitHub release lookup and runner availability checks.
- Added `manage.sh` options to run proxy lint, proxy tests, DevDash typecheck, and all checks inside containers.
- Added tests for proxy API/docs routing, duplicate static UI removal, and update version comparison.
- Fixed backend lint issues and made background timers non-blocking so the test suite exits cleanly.
- Stabilized provider scoring tests so they are isolated from Compose runtime provider-priority settings.

## v0.2.0 - 2026-04-28

- Redesigned DevDash around Melodarr Proxy with Dashboard, Insights, Analytics, Requests, Explorer, and Settings views.
- Added Explorer search modes for artist, song, album, and artist plus song workflows.
- Added visual Explorer results with artwork cards and a JSON tab for raw debug output.
- Added richer request trace inspection with provider timing, steps, raw details, and copyable logs.
- Added provider testing from Settings, including drag-and-drop provider priority and per-provider diagnostics.
- Added custom provider configuration and a visual mapping builder backed by proxy-side JSONPath transforms.
- Added MusicBrainz API key support and moved MusicBrainz identity/contact into runtime configuration.
- Fixed MusicBrainz TLS resets in Docker by running the proxy on a Debian Node image and routing MusicBrainz over IPv6.
- Restored DevDash Compose support on `DEVDASH_HOST_PORT` and added `manage.sh` network setup for local operation.
- Added debug endpoints for artist discovery, song-to-album lookup, provider tests, snapshots, and request tracing.

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

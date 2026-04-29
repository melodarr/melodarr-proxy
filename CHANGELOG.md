# Changelog

All notable changes to Melodarr Proxy will be documented here.

## v0.3.13 - 2026-04-29

- Removed build-time lockfiles from the final proxy and Melodash runtime images so vulnerability scans only evaluate runtime dependencies.
- Moved CI and container builds to Node.js 24 LTS.

## v0.3.12 - 2026-04-29

- Renamed the dashboard service and published image to Melodash.
- Updated Compose, Proxmox install/update scripts, docs, and release workflows to use `melodash` and `ghcr.io/melodarr/melodarr-proxy-melodash`.
- Removed development/test tooling from the production proxy image install path so vulnerability scans do not flag non-runtime packages.

## v0.3.11 - 2026-04-29

- Restored the separate dashboard container as a first-class deployed service.
- Added a production dashboard image so the operator UI can be deployed outside the proxy API image.
- Updated Compose and Proxmox install/update flows so standard installs can run `proxy`, `redis`, and the dashboard with the dashboard exposed on port `55026`.

## v0.3.10 - 2026-04-29

- Added packaged dashboard aliases so `/dashboard`, `/settings`, `/stats`, and `/login` serve the bundled operator UI without requiring `.html` paths.
- Added server coverage for the packaged dashboard routes.

## v0.3.9 - 2026-04-29

- Fixed the production Docker image build by removing an invalid Node base-image digest that prevented Buildx from resolving `node:20-bookworm-slim` for both `linux/amd64` and `linux/arm64`.
- Updated runtime version fallbacks and Lidarr setup examples to match the release version.
- Added README commands for pointing plugin-capable Lidarr installs at Melodarr Proxy lookups.

## v0.3.8 - 2026-04-29

- Resolved dashboard routing and enhanced the CI release pipeline with published artifacts.

## v0.3.7 - 2026-04-29

- Reverted v0.3.6. The proxy is API-only — `/api/*`, `/debug/*`, `/docs` (Scalar), `/openapi.json`. The operator dashboard is a separate web app and is not bundled into this image. `GET /` returns API metadata JSON, no static UI is served, and `public/` is no longer mounted.

## v0.3.5 - 2026-04-29

- Fixed proxy crash-looping on container start when the boot upstream probe failed (e.g. transient `ECONNRESET`/TLS resets reaching MusicBrainz). Boot now logs the unhealthy probe and continues; the upstream monitor retries on its own interval and `/api/ready` reflects cached state. Operators can reach Settings to reconfigure (e.g. switch `musicbrainzIpFamily` to `6`) instead of being locked out of the UI by a dying process.

## v0.3.4 - 2026-04-28

- Changed Proxmox installer default `APP_VERSION` from a pinned release tag to `latest`, so fresh installs pull whatever main has most recently published to GHCR. Pinning a specific build is still supported via `APP_VERSION=v0.3.3 ./install-proxmox-lxc.sh`. The `IMAGE` and runtime `APP_VERSION` env both derive from the same variable so they stay aligned with the override.
- Note: GHCR package visibility for `ghcr.io/melodarr/melodarr-proxy` must be set to **Public** under the org's package settings, otherwise unauthenticated pulls will fail with `unauthorized` regardless of which tag is requested.

## v0.3.3 - 2026-04-28

- Fixed Proxmox installer bootstrap failing on Debian 13 (trixie) because `software-properties-common` no longer exists. Trimmed the pre-Docker apt install list to the only packages the script actually uses (`ca-certificates`, `curl`); `gnupg`, `lsb-release`, `apt-transport-https`, and `software-properties-common` were unused.

## v0.3.2 - 2026-04-28

- Fixed Proxmox LXC installer pinning fresh installs to a stale image and runtime version. The image tag and `APP_VERSION` now resolve from a single `APP_VERSION` env var (default `v0.3.2`), keeping installer, container image, and runtime version aligned.

## v0.3.1 - 2026-04-28

- Fixed Proxmox LXC installer to list templates already on the chosen storage and let the operator pick one, falling back to `pveam available` when none are present locally. `TEMPLATE_FILE` env override is preserved for unattended runs; non-TTY runs without an override now exit with a clear error.

## v0.3.0 - 2026-04-29

- Added Scalar API documentation at `/docs` backed by `/openapi.json`.
- Split responsibilities so the proxy exposes API/docs only and Melodash owns the operator UI.
- Added an Updates page in Melodash with release status, changelog display, and a guarded update action.
- Added proxy update status and apply endpoints with GitHub release lookup and runner availability checks.
- Added `manage.sh` options to run proxy lint, proxy tests, Melodash typecheck, and all checks inside containers.
- Added tests for proxy API/docs routing, duplicate static UI removal, and update version comparison.
- Fixed backend lint issues and made background timers non-blocking so the test suite exits cleanly.
- Stabilized provider scoring tests so they are isolated from Compose runtime provider-priority settings.

## v0.2.0 - 2026-04-28

- Redesigned Melodash around Melodarr Proxy with Dashboard, Insights, Analytics, Requests, Explorer, and Settings views.
- Added Explorer search modes for artist, song, album, and artist plus song workflows.
- Added visual Explorer results with artwork cards and a JSON tab for raw debug output.
- Added richer request trace inspection with provider timing, steps, raw details, and copyable logs.
- Added provider testing from Settings, including drag-and-drop provider priority and per-provider diagnostics.
- Added custom provider configuration and a visual mapping builder backed by proxy-side JSONPath transforms.
- Added MusicBrainz API key support and moved MusicBrainz identity/contact into runtime configuration.
- Fixed MusicBrainz TLS resets in Docker by running the proxy on a Debian Node image and routing MusicBrainz over IPv6.
- Restored Melodash Compose support on `MELODASH_HOST_PORT` and added `manage.sh` network setup for local operation.
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

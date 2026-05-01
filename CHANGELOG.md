# Changelog

All notable changes to Melodarr Proxy will be documented here.

## v0.3.28 - 2026-05-01

- Fixed Proxmox installer's compose template so fresh installs route MusicBrainz over IPv6 by default. Removed `NODE_OPTIONS: --dns-result-order=ipv4first` (which forced Node to prefer IPv4 globally and caused TLS resets to MusicBrainz on networks where IPv4 fails) and added `MUSICBRAINZ_IP_FAMILY: "6"` so the proxy's https.Agent pins MusicBrainz to IPv6.
- Updated the upgrade script to auto-heal existing installs: after enabling Docker IPv6, it now also strips the `ipv4first` NODE_OPTIONS line and inserts `MUSICBRAINZ_IP_FAMILY: "6"` into the deployed compose. Existing installs flip green on next `upgrade-proxmox-lxc.sh` run.
- Updated the upgrade canary's `docker run` to use `MUSICBRAINZ_IP_FAMILY=6` instead of the IPv4-first NODE_OPTIONS, so canary contract validation passes on networks where only IPv6 reaches MusicBrainz.

## v0.3.27 - 2026-04-30

- Added `scripts/recover-compose.sh`: regenerates a clean `/opt/melodarr-proxy/compose.yml` on a deployed LXC and force-recreates the stack. Backs up the existing compose, validates YAML before applying, then polls `/api/ready` for up to 60s. Use it when manual sed edits or terminal-paste indentation drift have corrupted the deployed compose.
- Added `scripts/test-install.sh`: repeatable end-to-end install validation. Targets a Proxmox LXC via `CTID=...` or any `BASE_URL`. Runs colored PASS/FAIL checks for `/api/health`, `/api/ready`, `/api/version`, redis connectivity, Melodash HTML, LXC IPv6→MusicBrainz, Docker IPv6 enablement, in-container IPv6→MusicBrainz, upstream healthy, and end-to-end `/api/search`. On failure, prints actionable hints (e.g. the `daemon.json` snippet to enable Docker IPv6 when the LXC has IPv6 but the container does not).

## v0.3.26 - 2026-04-30

- Added `scripts/proxy-diag.sh`: command-line diagnostics for a deployed proxy. Subcommands `health`, `ready`, `version`, `mb [4|6|auto]`, `search`, `login`, `stats`, `settings`, `logs`, `set-ip-family`, `compose-cat`, `compose-validate`, `all`. Auto-targets the local LXC, a remote `pct exec $CTID`, or any `BASE_URL`. `set-ip-family` rewrites `MUSICBRAINZ_IP_FAMILY` in the deployed `compose.yml` via a base64-encoded Python helper instead of fragile multi-line sed (sidesteps the YAML corruption seen when running quoted sed through `pct exec bash -c`).
- Added the diagnostics runner as menu option 12 in `manage.sh`.

## v0.3.25 - 2026-04-30

- Made Melodash deployment-agnostic. Added `lib/proxy.ts` with `resolveProxyBaseUrl()` (env override → same-origin in browser → server fallback) and `fetchWithFallback()` that retries against `NEXT_PUBLIC_PROXY_FALLBACK` if the primary base fails. `lib/fetcher.ts` now routes any relative path through the resolver, so existing SWR keys like `/api/health` and `/debug/overview` automatically hit the right base.
- Removed the empty `baseUrl: ""` from `lib/services.ts`. `ServiceCard` and the `service/[name]` page no longer template a base into SWR keys; they just use paths.
- `ServiceCard` now renders a "Proxy unreachable" panel (with the underlying error message and a hint to set `NEXT_PUBLIC_PROXY_BASE_URL` or wire a reverse proxy) instead of staying stuck on "Checking" forever. The card and detail page also surface `version` and `instanceId` from `/api/health`.
- `ControlPanel` no longer takes a `baseUrl` prop; it routes through `fetchWithFallback`.

## v0.3.24 - 2026-04-30

- Added `service` and `version` fields to `/api/health` and `/api/ready` payloads so Melodash and other clients can identify the proxy without reading separate metadata. `service` reads from `APP_NAME` (default `melodarr-proxy`), `version` from `APP_VERSION`.
- Fixed `handleSearch` controller tests and lint that broke after the Lidarr-compatibility rewrite (`ec19ef4`) swapped `upstreamService.search` for `discoverArtists`. Tests now mock `discoverArtists` and assert the new missing-query error wording; the unused `upstreamService` require was removed.

## v0.3.21 - 2026-04-29

- Achieved 94%+ test coverage for proxy.controller by adding comprehensive unit tests with module mocking.
- Added unit tests for external dependencies including Cache, Providers, and Upstream Services.
- Resolved various linting issues caught by `standard` by cleaning up test code unused variables and spacing.
- Enforced `XDG_CACHE_HOME=.cache` for consistent lint caching across environments.

## v0.3.18 - 2026-04-29

- Granted the release workflow `contents: write` so GitHub release creation can generate and publish release notes after validation passes.

## v0.3.17 - 2026-04-29

- Published Melodash as `linux/amd64` in the release workflow to avoid the Next.js dashboard build hanging under ARM emulation. The proxy image remains multi-arch.

## v0.3.16 - 2026-04-29

- Pinned release scanning to `aquasecurity/trivy-action@v0.36.0` and opted GitHub JavaScript actions into Node.js 24 during release validation.

## v0.3.15 - 2026-04-29

- Fixed release canary validation to check public health, OpenAPI, and Scalar docs endpoints instead of calling authenticated artist lookup without an API key.

## v0.3.14 - 2026-04-29

- Removed bundled global npm/npx from final runtime images after dependency installation to avoid scanning unused npm internals.
- Started Melodash directly through Next's Node entrypoint instead of requiring npm at runtime.

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

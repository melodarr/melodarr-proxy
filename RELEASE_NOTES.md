# Melodarr Proxy v0.1.0

Initial open-source release for Melodarr Proxy, a lightweight music metadata proxy for personal Lidarr-style automation setups.

## Highlights

- Multi-provider artist metadata lookup with MusicBrainz, iTunes, TheAudioDB, Last.fm, and Discogs support.
- Redis-backed caching with in-memory fallback.
- Web UI for login, testing, settings, provider selection, API keys, stats, and dark/light mode.
- Persistent API-key authentication for Lidarr-facing endpoints.
- Provider visibility in lookup responses, response headers, and stats.
- Docker Compose setup with Redis, health checks, random host ports, and optional service profiles.
- Yarn-based development workflow with lint, tests, CI, Dependabot, and GHCR image publishing.
- Production container starts as root only to repair `/data` volume ownership, then runs the Node process as the `melodarr` user.

## Compatibility

This release is not a full Lidarr metadata-server replacement. Current support is focused on:

- `GET /api/v1/artist/lookup?term={artist}`
- album-level normalized metadata
- cached repeated lookup behavior

Known gaps are tracked in `docs/lidarr-compatibility.md` and `ROADMAP.md`.

## Verification

Release checks run locally:

- `yarn lint`
- `yarn test`
- `docker compose config --quiet`
- `docker compose --profile test build test`
- `docker compose up -d --build proxy`

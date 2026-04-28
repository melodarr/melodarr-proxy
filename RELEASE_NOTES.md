# Melodarr Proxy v0.2.0

Feature release focused on the Melodarr Proxy control plane, provider diagnostics, custom provider setup, and Docker networking reliability.

## Highlights

- Redesigned DevDash with dedicated Dashboard, Insights, Analytics, Requests, Explorer, and Settings pages.
- Added Explorer search modes for artist, song, album, and artist plus song lookups.
- Added a visual Explorer result view with artwork cards, plus a JSON tab for the original debug payload.
- Added request trace details, provider timing, raw diagnostics, and copyable log output.
- Added Settings provider testing with drag-and-drop provider priority.
- Added custom provider configuration with a visual JSON mapping builder.
- Added MusicBrainz API key support and runtime identity/contact configuration.
- Fixed MusicBrainz Docker TLS failures by moving the proxy runtime to Debian Node and preferring IPv6 for MusicBrainz.
- Restored DevDash Compose support on `DEVDASH_HOST_PORT=55026`.
- Added `manage.sh` network setup for local start/rebuild flows.

## Compatibility

The proxy still focuses on artist lookup compatibility first:

- `GET /api/v1/artist/lookup?term={artist}`
- album-level normalized metadata
- provider fallback and cache behavior

Explorer and debug endpoints are intended for operator workflows and provider diagnostics, not Lidarr compatibility.

## Verification

Release checks run locally:

- `docker compose config --quiet`
- `docker compose --profile devdash build devdash`
- Browser smoke test for Explorer Visual and JSON tabs
- MusicBrainz container connectivity check over IPv6

Known test gap:

- `yarn test` currently fails in existing controller tests because the test cache mock is missing `cache.acquireLock` and one cached response fixture is stale.

# Melodarr Proxy

Melodarr Proxy is a lightweight, self-hostable music metadata proxy for personal automation setups. It queries live metadata providers, caches normalized responses, and exposes a small Lidarr-style API surface without requiring a local MusicBrainz database or Solr index.

## Why This Exists

Full metadata stacks can be expensive to run for small setups. Melodarr Proxy focuses on:

- live provider lookups
- aggressive caching
- provider fallback
- observable request behavior
- low-resource Docker deployment

This is not a full metadata-server replacement yet. Compatibility is intentionally partial while the API surface stabilizes.

## Features

- MusicBrainz-backed artist lookup
- Optional iTunes, TheAudioDB, Last.fm, and Discogs providers
- Redis cache with in-memory fallback
- Provider visibility in lookup responses and stats
- Web UI for testing, stats, settings, and first-run admin setup
- Docker Compose deployment with random host ports
- Yarn-based development workflow

## Quick Start

```bash
cp .env.example .env
docker compose up --build
```

Ports are randomized by default. Find the active proxy port with:

```bash
docker compose port proxy 3000
```

Optional services use Compose profiles:

```bash
docker compose --profile devdash up -d
docker compose --profile auth up -d
docker compose --profile test build test
```

Published images are built by GitHub Actions and published to:

```text
ghcr.io/melodarr/melodarr-proxy
```

## Proxmox LXC Install

Use [scripts/install-proxmox-lxc.sh](scripts/install-proxmox-lxc.sh) on a Proxmox host to create a Debian 12 LXC, install Docker inside it, and start Melodarr Proxy with Redis.

```bash
bash scripts/install-proxmox-lxc.sh
```

Run it as `root` on the Proxmox host. Edit the user settings at the top of the script first, especially `PASSWORD`, `APP_CONTACT`, `STORAGE`, `BRIDGE`, and `TEMPLATE_FILE`.

The script expects the Debian 12 LXC template to already exist on the Proxmox host. If needed:

```bash
pveam update
pveam available | grep debian-12
pveam download local debian-12-standard_12.12-1_amd64.tar.zst
```

Common overrides:

```bash
CTID=3055 HOST_PORT=3055 APP_CONTACT=you@example.com bash scripts/install-proxmox-lxc.sh
```

## Local Development

```bash
yarn install
yarn dev
```

Run checks:

```bash
yarn lint
yarn test
docker compose --profile test build test
```

## Verify

```bash
curl http://localhost:3055/api/health
curl "http://localhost:3055/api/v1/artist/lookup?term=radiohead"
```

Expected:

- `/api/health` returns `"status": "ok"`
- `/api/v1/artist/lookup` returns artist, albums, and provider metadata

## Configuration

Copy `.env.example`:

```bash
cp .env.example .env
```

Key variables:

- `HOST_PORT` controls the proxy host port. Use `0` or leave unset for a random port.
- `REDIS_URL` points to the cache backend.
- `APP_NAME`, `APP_VERSION`, and `APP_CONTACT` define the MusicBrainz User-Agent identity.
- `METADATA_PROVIDERS` is a comma-separated provider list.
- `PROVIDER_PRIORITY` controls merge preference when providers disagree.
- `THEAUDIODB_API_KEY`, `LASTFM_API_KEY`, and `DISCOGS_TOKEN` enable optional providers.
- `ITUNES_COUNTRY` controls the iTunes storefront country.

Provider details are documented in [docs/providers.md](docs/providers.md).

## API

See [docs/api.md](docs/api.md) for the full API reference.

Proxy endpoints accept either an authenticated admin browser session or an API key. For Lidarr or scripts, create an API key on the Settings page and send it as:

```text
X-Api-Key: mp_...
```

The `api_key` query parameter is also supported for clients that cannot set custom headers.

### `GET /api/v1/artist/lookup?term={name}`

Returns a normalized artist response:

```json
{
  "artistName": "Radiohead",
  "foreignArtistId": "",
  "providers": [
    { "name": "musicbrainz", "albumCount": 18 },
    { "name": "itunes", "albumCount": 27 }
  ],
  "albums": [
    {
      "title": "OK Computer",
      "id": "...",
      "firstReleaseDate": "1997",
      "coverUrl": "...",
      "provider": "musicbrainz",
      "ids": {}
    }
  ]
}
```

Response headers include:

- `X-Cache`: `HIT` or `MISS`
- `X-Upstream-Calls`: upstream provider calls for a cache miss
- `X-Providers`: comma-separated provider names used for the response

## Observability

- `GET /api/health`
- `GET /api/stats`
- `GET /api/stats/history`
- `GET /api/version`

The Stats page also shows provider calls, errors, and average latency.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## Lidarr Compatibility

See [docs/lidarr-compatibility.md](docs/lidarr-compatibility.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT

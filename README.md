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

Run this on the Proxmox host as `root`. It creates a Debian 12 LXC, installs Docker inside it, and starts Melodarr Proxy with Redis.

Before running, adjust `PASSWORD` and `APP_CONTACT`. Change `STORAGE`, `ROOTFS_STORAGE`, or `BRIDGE` if your Proxmox node uses different names.

```bash
#!/usr/bin/env bash
set -euo pipefail

VMID="${VMID:-3055}"
HOSTNAME="${HOSTNAME:-melodarr-proxy}"
STORAGE="${STORAGE:-local}"
ROOTFS_STORAGE="${ROOTFS_STORAGE:-local-lvm}"
BRIDGE="${BRIDGE:-vmbr0}"
DISK_SIZE="${DISK_SIZE:-8}"
MEMORY="${MEMORY:-1024}"
CORES="${CORES:-1}"
PASSWORD="${PASSWORD:-change-this-password}"
HOST_PORT="${HOST_PORT:-3055}"
APP_CONTACT="${APP_CONTACT:-admin@example.com}"
IMAGE="${IMAGE:-ghcr.io/melodarr/melodarr-proxy:v0.1.0}"
TEMPLATE="${TEMPLATE:-}"

if pct status "$VMID" >/dev/null 2>&1; then
  echo "LXC $VMID already exists. Choose another VMID or remove the existing container."
  exit 1
fi

pveam update
if [ -z "$TEMPLATE" ]; then
  TEMPLATE="$(pveam available --section system | awk '/debian-12-standard/ {print $2}' | sort -V | tail -n 1)"
fi

if ! pveam list "$STORAGE" | grep -q "$TEMPLATE"; then
  pveam download "$STORAGE" "$TEMPLATE"
fi

pct create "$VMID" "$STORAGE:vztmpl/$TEMPLATE" \
  --hostname "$HOSTNAME" \
  --ostype debian \
  --unprivileged 1 \
  --features nesting=1,keyctl=1 \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --rootfs "$ROOTFS_STORAGE:$DISK_SIZE" \
  --net0 "name=eth0,bridge=$BRIDGE,ip=dhcp" \
  --password "$PASSWORD" \
  --start 1

pct exec "$VMID" -- bash -lc '
set -euo pipefail
apt-get update
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
mkdir -p /opt/melodarr-proxy
'

pct exec "$VMID" -- bash -lc "cat > /opt/melodarr-proxy/compose.yml" <<EOF
services:
  proxy:
    image: ${IMAGE}
    restart: unless-stopped
    environment:
      PORT: 3000
      REDIS_URL: redis://redis:6379
      DATA_DIR: /data
      HOST_PORT: ${HOST_PORT}
      APP_NAME: melodarr-proxy
      APP_VERSION: 0.1.0
      APP_CONTACT: ${APP_CONTACT}
      METADATA_PROVIDERS: musicbrainz,itunes
      PROVIDER_PRIORITY: musicbrainz,theaudiodb,itunes,lastfm,discogs
      MUSICBRAINZ_BASE_URL: https://musicbrainz.org/ws/2
      MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS: 1100
      CACHE_TTL_SECONDS: 86400
      UPSTREAM_TIMEOUT_MS: 8000
      SLOW_REQUEST_MS: 2000
      NODE_OPTIONS: --dns-result-order=ipv4first
    ports:
      - "${HOST_PORT}:3000"
    volumes:
      - melodarr_proxy_data:/data
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--save", "", "--appendonly", "no"]

volumes:
  melodarr_proxy_data:
EOF

pct exec "$VMID" -- bash -lc '
set -euo pipefail
cd /opt/melodarr-proxy
docker compose up -d
'

IP="$(pct exec "$VMID" -- hostname -I | awk "{print \$1}")"
echo "Melodarr Proxy is starting at: http://${IP}:${HOST_PORT}"
echo "Open the URL and create the first-run admin password."
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

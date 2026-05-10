# Production Install Examples

This guide shows the supported production install shapes:

- source build from a git checkout
- GHCR image install
- Proxmox LXC install
- pinned-version installs instead of moving `latest`

For release support and rollback policy, see [release-support.md](release-support.md).

## Images

Published images:

```text
ghcr.io/melodarr/melodarr-proxy:<version>
ghcr.io/melodarr/melodarr-proxy-melodash:<version>
```

Examples:

```text
ghcr.io/melodarr/melodarr-proxy:0.3.42
ghcr.io/melodarr/melodarr-proxy-melodash:0.3.42
ghcr.io/melodarr/melodarr-proxy:latest
ghcr.io/melodarr/melodarr-proxy-melodash:latest
```

Use pinned versions for production. Use `latest` for labs, early testing, or installs where you are comfortable updating immediately.

## Required Runtime Settings

At minimum, set a real contact address for MusicBrainz User-Agent policy:

```env
APP_NAME=melodarr-proxy
APP_VERSION=0.3.42
APP_CONTACT=https://github.com/melodarr/melodarr-proxy
```

`APP_CONTACT` must be a real contact email address or a valid http(s) URL. Do not use placeholder
addresses from `example.com`, `example.org`, or `example.net`; MusicBrainz uses
the User-Agent identity for throttling/contact policy and Melodarr diagnostics
will flag placeholder contacts.

Common production values:

```env
HOST_PORT=3055
MELODASH_HOST_PORT=55026
REQUIRE_API_KEY=true
ADMIN_PASSWORD=change-this-long-password
SETTINGS_SESSION_SECRET=change-this-random-secret
REDIS_URL=redis://redis:6379
DATA_DIR=/data
MUSICBRAINZ_BASE_URL=https://musicbrainz.org/ws/2
MUSICBRAINZ_IP_FAMILY=6
METADATA_PROVIDERS=musicbrainz,itunes
PROVIDER_PRIORITY=musicbrainz,theaudiodb,itunes,lastfm,discogs
CACHE_TTL_SECONDS=86400
```

Optional provider credentials:

```env
MUSICBRAINZ_API_KEY=
THEAUDIODB_API_KEY=
LASTFM_API_KEY=
DISCOGS_TOKEN=
ITUNES_COUNTRY=US
```

## Source Build Install

Use this when you want to build the local checkout yourself.

```bash
git clone https://github.com/melodarr/melodarr-proxy.git
cd melodarr-proxy
cp .env.example .env
```

Edit `.env`:

```env
HOST_PORT=3055
MELODASH_HOST_PORT=55026
APP_CONTACT=https://github.com/melodarr/melodarr-proxy
REQUIRE_API_KEY=true
ADMIN_PASSWORD=change-this-long-password
SETTINGS_SESSION_SECRET=change-this-random-secret
```

Enable Docker IPv6 and create the external Docker network expected by the
bundled Compose file:

```bash
sudo ./scripts/ensure-docker-ipv6.sh
```

Do not create `melodarr-ipv6` without IPv6. MusicBrainz is treated as
IPv6-only by Melodarr Proxy, so an IPv4-only Docker network will leave
MusicBrainz diagnostics and readiness degraded.

Build and start proxy, Redis, and Melodash:

```bash
docker compose -f docker-compose.yml -f docker-compose.ipv6.yml up -d --build proxy redis melodash
```

Verify:

```bash
docker compose ps
curl -s http://127.0.0.1:3055/api/health
curl -s http://127.0.0.1:3055/api/ready
```

The source checkout should publish stable ports:

```text
proxy    0.0.0.0:3055->3000/tcp
melodash 0.0.0.0:55026->3000/tcp
```

If `proxy` is published on a random high port or Melodash is published on `3055`, confirm `.env` uses:

```env
HOST_PORT=3055
MELODASH_HOST_PORT=55026
```

Then recreate the services:

```bash
docker compose down
docker compose up -d --build
```

Open Melodash:

```text
http://localhost:55026/dashboard
```

Update source installs:

```bash
git pull
docker compose up -d --build proxy redis melodash
```

## GHCR Image Install

Use this when you want to run published images without building locally.

Create a production compose file:

```bash
mkdir -p /opt/melodarr-proxy
cd /opt/melodarr-proxy
```

Create `compose.yml`:

```yaml
services:
  proxy:
    image: ghcr.io/melodarr/melodarr-proxy:0.3.42
    restart: unless-stopped
    environment:
      PORT: 3000
      REQUIRE_API_KEY: "true"
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      SETTINGS_SESSION_SECRET: ${SETTINGS_SESSION_SECRET}
      REDIS_URL: redis://redis:6379
      DATA_DIR: /data
      APP_NAME: melodarr-proxy
      APP_VERSION: 0.3.42
      APP_CONTACT: ${APP_CONTACT}
      MUSICBRAINZ_BASE_URL: https://musicbrainz.org/ws/2
      MUSICBRAINZ_IP_FAMILY: "6"
      MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS: 1100
      CACHE_TTL_SECONDS: 86400
      UPSTREAM_TIMEOUT_MS: 8000
      METADATA_PROVIDERS: musicbrainz,itunes
      PROVIDER_PRIORITY: musicbrainz,theaudiodb,itunes,lastfm,discogs
      THEAUDIODB_API_KEY: ${THEAUDIODB_API_KEY:-}
      LASTFM_API_KEY: ${LASTFM_API_KEY:-}
      DISCOGS_TOKEN: ${DISCOGS_TOKEN:-}
      ITUNES_COUNTRY: ${ITUNES_COUNTRY:-US}
    ports:
      - "3055:3000"
    volumes:
      - melodarr_proxy_data:/data
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--save", "", "--appendonly", "no", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]

  melodash:
    image: ghcr.io/melodarr/melodarr-proxy-melodash:0.3.42
    restart: unless-stopped
    environment:
      PORT: 3000
      PROXY_API_URL: http://proxy:3000/api
      NEXT_PUBLIC_PROXY_BASE_URL: ${NEXT_PUBLIC_PROXY_BASE_URL:-}
      NEXT_PUBLIC_PROXY_FALLBACK: ${NEXT_PUBLIC_PROXY_FALLBACK:-}
    ports:
      - "55026:3000"
    depends_on:
      - proxy

volumes:
  melodarr_proxy_data:
```

Create `.env`:

```env
APP_CONTACT=https://github.com/melodarr/melodarr-proxy
ADMIN_PASSWORD=change-this-long-password
SETTINGS_SESSION_SECRET=change-this-random-secret
THEAUDIODB_API_KEY=
LASTFM_API_KEY=
DISCOGS_TOKEN=
ITUNES_COUNTRY=US
```

Start:

```bash
docker compose pull
docker compose up -d
```

Verify:

```bash
docker compose ps
curl -s http://127.0.0.1:3055/api/health
curl -s http://127.0.0.1:3055/api/ready
```

## Pinned-Version Install

Production installs should pin both proxy and Melodash to the same version:

```yaml
services:
  proxy:
    image: ghcr.io/melodarr/melodarr-proxy:0.3.42

  melodash:
    image: ghcr.io/melodarr/melodarr-proxy-melodash:0.3.42
```

Upgrade to a specific version:

```bash
cd /opt/melodarr-proxy
sed -i.bak \
  -e 's#ghcr.io/melodarr/melodarr-proxy:0.3.42#ghcr.io/melodarr/melodarr-proxy:0.3.43#g' \
  -e 's#ghcr.io/melodarr/melodarr-proxy-melodash:0.3.42#ghcr.io/melodarr/melodarr-proxy-melodash:0.3.43#g' \
  compose.yml
docker compose pull
docker compose up -d
```

Rollback:

```bash
cd /opt/melodarr-proxy
mv compose.yml.bak compose.yml
docker compose pull
docker compose up -d
```

Avoid pinning only one service. Proxy and Melodash are released together and should normally run the same tag.

## Latest-Tag Install

Use `latest` only when moving updates are acceptable:

```yaml
services:
  proxy:
    image: ghcr.io/melodarr/melodarr-proxy:latest

  melodash:
    image: ghcr.io/melodarr/melodarr-proxy-melodash:latest
```

Update:

```bash
docker compose pull
docker compose up -d
docker image prune -f
```

`latest` makes rollback harder because the tag moves. Before updating, capture the current image digests:

```bash
docker image inspect ghcr.io/melodarr/melodarr-proxy:latest --format '{{index .RepoDigests 0}}'
docker image inspect ghcr.io/melodarr/melodarr-proxy-melodash:latest --format '{{index .RepoDigests 0}}'
```

## Proxmox LXC Install

Run the installer from the Proxmox host as `root`:

```bash
CTID=163 \
HOSTNAME=melodarr-proxy \
PASSWORD='change-this-lxc-password' \
APP_CONTACT=https://github.com/melodarr/melodarr-proxy \
APP_VERSION=0.3.42 \
HOST_PORT=3055 \
MELODASH_HOST_PORT=55026 \
bash scripts/install-proxmox-lxc.sh
```

The installer:

- creates a Debian LXC
- installs Docker and Docker Compose inside the LXC
- writes `/opt/melodarr-proxy/compose.yml`
- starts `proxy`, `redis`, and `melodash`
- creates an upgrade script for that CTID

Verify from the Proxmox host:

```bash
pct exec 163 -- docker ps
pct exec 163 -- curl -s http://127.0.0.1:3055/api/health
pct exec 163 -- curl -s http://127.0.0.1:3055/api/ready
pct exec 163 -- hostname -I
```

Then open:

```text
http://<lxc-ip>:55026/dashboard
```

### Proxmox Pinned Version

Use `APP_VERSION` to pin both proxy and Melodash:

```bash
APP_VERSION=0.3.42 bash scripts/install-proxmox-lxc.sh
```

The installer expands that to:

```text
ghcr.io/melodarr/melodarr-proxy:0.3.42
ghcr.io/melodarr/melodarr-proxy-melodash:0.3.42
```

### Proxmox Source Fallback

The LXC installer prefers GHCR images. Source fallback is disabled by default because official images are the reproducible release artifact.

To allow fallback when GHCR pull fails:

```bash
ALLOW_SOURCE_FALLBACK=true bash scripts/install-proxmox-lxc.sh
```

Use this only when you understand the installed image may differ from the published release image.

## Post-Install Checklist

Run:

```bash
curl -s http://127.0.0.1:3055/api/health
curl -s http://127.0.0.1:3055/api/ready
curl -s http://127.0.0.1:3055/openapi.json
```

Then:

- open Melodash at `http://<host>:55026/dashboard`
- complete first-run settings setup if `ADMIN_PASSWORD` was not provided
- create an API key for Lidarr or other clients
- test providers from Melodash Settings
- confirm Redis is connected in `/api/ready`
- confirm MusicBrainz is reachable or intentionally degraded

## Reverse Proxy

For public hostnames, keep proxy and Melodash separate:

```text
https://melodarr-proxy.example.com -> proxy:3055
https://melodash.example.com       -> melodash:55026
```

See [reverse-proxy.md](reverse-proxy.md) for Caddy, Nginx Proxy Manager, and Traefik examples.

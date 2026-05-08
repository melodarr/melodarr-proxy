# Troubleshooting

This guide covers the failures operators hit most often: MusicBrainz TLS resets, IPv6/Docker/Proxmox networking, Redis disconnects, degraded upstream readiness, Lidarr response errors, and provider API token problems.

## First Checks

Run these before changing configuration:

```bash
docker compose ps
curl -s http://127.0.0.1:3055/api/health
curl -s http://127.0.0.1:3055/api/ready
curl -s http://127.0.0.1:3055/api/version
docker compose logs --tail=150 proxy
```

For Proxmox LXC installs, run from the Proxmox host:

```bash
pct exec <ctid> -- docker ps
pct exec <ctid> -- curl -s http://127.0.0.1:3055/api/health
pct exec <ctid> -- curl -s http://127.0.0.1:3055/api/ready
```

Interpretation:

- `/api/health` answers whether the proxy process is alive.
- `/api/ready` answers whether dependencies and providers are ready.
- A healthy `/api/health` with degraded `/api/ready` usually means the app is running but Redis or an upstream provider is impaired.

## MusicBrainz `ECONNRESET`

Common error:

```json
{
  "message": "Client network socket disconnected before secure TLS connection was established",
  "code": "ECONNRESET",
  "status": null
}
```

This means the container can open a TCP connection but the TLS handshake is
reset before completion. MusicBrainz is IPv6-only for this proxy — IPv4 is
never a valid fallback. The failure is always in the network path, not the
application.

**Common causes:**

| Environment | Root Cause |
| --- | --- |
| Proxmox / LXC | Docker inside the LXC has IPv6 disabled or no AAAA route. |
| Docker Desktop (macOS/Windows) | PMTUD black hole — TLS handshake packets exceed effective MTU through the Linux VM; ICMP6 PTB is swallowed. |
| Linux host | Docker daemon missing `"ipv6": true` or IPv6 forwarding disabled. |

**Diagnose:**

```bash
curl -s "http://127.0.0.1:3055/debug/diagnose?provider=musicbrainz"
curl -s http://127.0.0.1:3055/debug/upstream
scripts/proxy-diag.sh diagnose
scripts/proxy-diag.sh mb 6
```

Read the response:

- `failedStep: "dns"` — name resolution failed.
- `failedStep: "tcp"` — DNS worked, TCP/443 routing failed (`ENETUNREACH`).
- `failedStep: "tls"` — TCP connected, TLS handshake was reset (`ECONNRESET`).
- `failedStep: "http"` — TLS worked, MusicBrainz returned an HTTP error.

**Fix:**

For Proxmox/LXC/Linux:

```bash
sudo ./scripts/ensure-docker-ipv6.sh
docker compose -f docker-compose.yml -f docker-compose.ipv6.yml up -d --force-recreate
```

For Docker Desktop, enable IPv6 in the daemon config (Settings → Docker
Engine):

```json
{
  "ipv6": true,
  "fixed-cidr-v6": "fd00:dead:beef::/64",
  "ip6tables": true,
  "experimental": true
}
```

Then recreate containers:

```bash
docker compose down --remove-orphans
docker compose up -d --build proxy redis melodash
```

The diagnostic probe retries up to 3 times to absorb intermittent PMTUD
failures. Production MusicBrainz requests also retry (up to 3 attempts with
backoff). If failures are consistent rather than intermittent, the IPv6 path
is fundamentally broken — check ISP support, router advertisements, and
Docker daemon configuration.

MusicBrainz also requires a meaningful User-Agent identity. Set `APP_CONTACT`
to a real email address or contact URL; `example.com`, `example.org`, and
`example.net` placeholder addresses are diagnosed as invalid because they can
be treated like anonymous/fake clients by upstream policy.

> **Never set `MUSICBRAINZ_IP_FAMILY` to `4`.** MusicBrainz does not serve
> API responses over IPv4. If IPv6 is broken, fix the transport layer.

## IPv6, Docker, And Proxmox Networking

Symptoms:

```text
ENETUNREACH
EHOSTUNREACH
ECONNRESET
Cannot reach MusicBrainz from Docker network
```

Check the host and container paths separately.

On the host:

```bash
curl -6 -I -H "User-Agent: melodarr-proxy-diag/1.0 (${APP_CONTACT:-operator@melodarr.org})" https://musicbrainz.org/
```

From the Compose network:

```bash
docker compose run --rm --no-deps proxy node -e "require('https').get('https://musicbrainz.org/ws/2/artist/?query=test&fmt=json&limit=1',{family:6,headers:{'User-Agent':\`melodarr-proxy-diag/1.0 (\${process.env.APP_CONTACT || 'operator@melodarr.org'})\`}},r=>{console.log(r.statusCode);r.resume()}).on('error',e=>{console.error(e.code,e.message);process.exit(1)})"
```

If IPv6 ping works but MusicBrainz still fails during TLS, treat it as a TLS-path failure, not an IPv6 routing failure. Example:

```text
ping -6 2606:4700:4700::1111 succeeds
curl -6 https://musicbrainz.org/ connects to TCP/443
OpenSSL SSL_connect: SSL_ERROR_SYSCALL
```

In that case, collect `/debug/diagnose?provider=musicbrainz` and container-level `curl -6` results before changing application code. The proxy cannot fix an upstream or network middlebox resetting TLS after TCP connect.

Check Docker network configuration:

```bash
docker network ls
docker network inspect melodarr-ipv6
docker compose config
```

For Proxmox LXC, also check:

```bash
pct config <ctid>
pct exec <ctid> -- cat /etc/docker/daemon.json
pct exec <ctid> -- docker network ls
pct exec <ctid> -- docker network inspect melodarr-ipv6
```

If host IPv6 works but Docker IPv6 does not, enable IPv6 in Docker inside the LXC and recreate the Compose network. The project upgrade/install scripts attempt to handle this, but manually edited containers may need repair.

Useful recovery commands:

```bash
cd /opt/melodarr-proxy/src-branch-build
sudo ./scripts/ensure-docker-ipv6.sh
cd /opt/melodarr-proxy
docker compose up -d --force-recreate
CTID=<ctid> ./scripts/upgrade-proxmox-lxc.sh
```

> **Do not switch MusicBrainz to IPv4.** Melodarr Proxy treats MusicBrainz as
> IPv6-only; IPv4 probes are intentionally not part of the MusicBrainz path.
> This is an immutable invariant — see the README.

## Redis Disconnected

Symptoms in `/api/ready`:

```json
{
  "cache": "degraded",
  "redisConnected": false
}
```

The proxy can continue with in-memory cache, but cache entries will not be shared across instances and will disappear on restart.

Check:

```bash
docker compose ps redis
docker compose logs --tail=150 redis
docker compose logs --tail=150 proxy
curl -s http://127.0.0.1:3055/debug/cache
```

Verify the proxy points at the Compose Redis service:

```env
REDIS_URL=redis://redis:6379
```

Then recreate:

```bash
docker compose up -d redis proxy
```

If Redis repeatedly exits, check memory limits and volume/custom command changes. The bundled Redis command uses an in-memory LRU cache:

```text
redis-server --save "" --appendonly no --maxmemory 256mb --maxmemory-policy allkeys-lru
```

## Upstream Degraded

`/api/ready` may show:

```json
{
  "status": "degraded",
  "upstream": "unreachable"
}
```

This means the app is alive, but one or more required upstream checks are failing.

Check the details:

```bash
curl -s http://127.0.0.1:3055/api/ready
curl -s http://127.0.0.1:3055/debug/providers/health
curl -s http://127.0.0.1:3055/debug/providers/metrics
curl -s http://127.0.0.1:3055/debug/upstream
```

If `musicbrainz` is the only failing provider, see the MusicBrainz and IPv6 sections above.

If an optional provider is failing because of credentials, disable it until the token is fixed:

```env
METADATA_PROVIDERS=musicbrainz,itunes
```

or fix the token in Melodash Settings.

Provider circuit-breaker behavior:

- repeated failures move a provider from healthy to degraded to disabled
- disabled providers are skipped during normal aggregation
- canary attempts happen after cooldown
- providers only reenable after multiple successful canary calls inside the reenable window

Relevant knobs:

```env
PROVIDER_FAILURE_THRESHOLD=3
PROVIDER_COOLDOWN_MS=600000
PROVIDER_REENABLE_SUCCESS_THRESHOLD=3
PROVIDER_REENABLE_WINDOW_MS=300000
```

## Lidarr Invalid Response Errors

Common Lidarr error:

```text
Invalid response received from LidarrAPI
```

Likely causes:

- old proxy version before SkyHook search-shape fixes
- response shape regression
- Lidarr/plugin is pointed at the wrong base URL
- API key is missing or being stripped
- provider returned malformed data that was not filtered
- MusicBrainz is unavailable and the fallback provider cannot supply canonical IDs

Check version first:

```bash
curl -s http://127.0.0.1:3055/api/version
```

Update if you are not on the latest supported patch. See [release-support.md](release-support.md).

Verify the response shape:

```bash
curl -s \
  -H "X-Api-Key: mp_your_key_here" \
  "http://127.0.0.1:3055/api/search?q=radiohead"
```

Expected search items are wrapped for SkyHook compatibility:

```json
[
  {
    "artist": {
      "artistName": "Radiohead"
    }
  }
]
```

Verify lookup:

```bash
curl -s \
  -H "X-Api-Key: mp_your_key_here" \
  "http://127.0.0.1:3055/api/v1/artist/lookup?term=radiohead"
```

If the client cannot preserve query parameters, use the path API-key form:

```text
http://proxy:3000/api/mp_your_key_here
```

For Docker-to-Docker Lidarr, do not use `localhost` unless Lidarr is in the same container. Use a reachable host or Compose service name:

```text
http://proxy:3000
http://melodarr-proxy:3055
```

Collect these when reporting:

```bash
curl -s http://127.0.0.1:3055/api/ready
curl -s http://127.0.0.1:3055/debug/providers/health
docker compose logs --tail=150 proxy
```

## Provider API Tokens

Provider token symptoms:

```text
Request failed with status code 401
Request failed with status code 403
Request failed with status code 404
token not configured
quota exceeded
```

Token variables:

```env
MUSICBRAINZ_API_KEY=
THEAUDIODB_API_KEY=
LASTFM_API_KEY=
DISCOGS_TOKEN=
```

Check active runtime settings from Melodash Settings, or through the API after login. Saved runtime settings override environment values, so an old saved token can shadow a fixed `.env` value.

If a saved setting is shadowing env defaults, reset it from Melodash Settings or clear the runtime override:

```bash
curl -X DELETE http://127.0.0.1:3055/api/settings/runtime/discogsToken
curl -X DELETE http://127.0.0.1:3055/api/settings/runtime/lastfmApiKey
curl -X DELETE http://127.0.0.1:3055/api/settings/runtime/theAudioDbApiKey
curl -X DELETE http://127.0.0.1:3055/api/settings/runtime/musicbrainzApiKey
```

These settings endpoints require an authenticated settings session.

Provider-specific notes:

- MusicBrainz public API works without a key but requires a valid User-Agent identity from `APP_NAME`, `APP_VERSION`, and `APP_CONTACT`.
- TheAudioDB requires the correct API key path; a wrong key can look like a provider failure.
- Last.fm returns auth errors when `LASTFM_API_KEY` is missing or invalid.
- Discogs requires `DISCOGS_TOKEN` and uses the `Discogs token=<token>` authorization format.

Test providers from Melodash Settings after changing tokens, then check:

```bash
curl -s http://127.0.0.1:3055/debug/providers/health
curl -s http://127.0.0.1:3055/debug/providers/metrics
```

## Melodash Cannot Reach Proxy

Symptoms:

```text
Proxy unreachable
Unexpected token '<', "<!doctype "... is not valid JSON
```

This often means Melodash fetched an HTML page instead of the proxy API.

Check:

```bash
docker compose ps melodash proxy
docker compose logs --tail=150 melodash
docker compose logs --tail=150 proxy
curl -s http://127.0.0.1:3055/api/health
```

Standard Compose setting:

```env
PROXY_API_URL=http://proxy:3000/api
```

Reverse proxy/browser settings:

```env
NEXT_PUBLIC_PROXY_BASE_URL=https://melodarr-proxy.example.com
NEXT_PUBLIC_PROXY_FALLBACK=http://localhost:3055
```

If Melodash is served from `https://melodash.example.com`, make sure API requests go to the proxy host, not back to the Melodash app route.

## Melodash Shows `Proxy unreachable` Or Public `/api/*` Returns 502

Symptoms:

```text
Proxy unreachable (https://melodash.example.com/api/health — Primary returned 502)
Proxy unreachable (https://melodash.example.com/api/settings — Primary returned 502)
openresty 502 Bad Gateway
curl: (7) Failed to connect to 127.0.0.1 port 3055
```

This means Melodash loaded, but its browser-side API calls cannot reach the proxy backend. It is not a MusicBrainz failure until the proxy API itself is reachable.

First verify the proxy locally from the Docker host or LXC:

```bash
cd /opt/melodarr-proxy/src-branch-build

docker compose ps
curl -i http://127.0.0.1:3055/api/health
curl -i http://127.0.0.1:3055/api/settings/status
```

The expected port mapping is:

```text
proxy    0.0.0.0:3055->3000/tcp
melodash 0.0.0.0:55026->3000/tcp
```

If `docker compose ps` shows a random proxy port such as `32769->3000/tcp`, or shows Melodash on `3055`, fix the source-checkout `.env`:

```bash
cd /opt/melodarr-proxy/src-branch-build

cat > .env <<'EOF'
HOST_PORT=3055
MELODASH_HOST_PORT=55026
EOF

docker compose down
docker compose up -d --build
docker compose ps
curl -i http://127.0.0.1:3055/api/health
```

For same-origin public Melodash deployments, the reverse proxy must route API paths to the proxy backend and everything else to Melodash:

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:3055;
}

location /debug/ {
  proxy_pass http://127.0.0.1:3055;
}

location / {
  proxy_pass http://127.0.0.1:55026;
}
```

If `/api/health` works on `127.0.0.1:3055` but fails through the public hostname, the issue is reverse-proxy routing. If `127.0.0.1:3055` fails locally, the proxy container is down or not published on the expected port.

## What To Include In A Bug Report

Use [SUPPORT.md](../SUPPORT.md), but the minimum useful set is:

```bash
docker compose ps
curl -s http://127.0.0.1:3055/api/health
curl -s http://127.0.0.1:3055/api/ready
curl -s http://127.0.0.1:3055/api/version
docker compose logs --tail=150 proxy
docker compose logs --tail=150 melodash
docker compose logs --tail=150 redis
```

Redact API keys, provider tokens, admin passwords, cookies, and private hostnames.

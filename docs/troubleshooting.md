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

This usually means the container can open a connection path but the TLS handshake is reset before completion. In Proxmox/LXC environments it is often tied to IPv4/IPv6 routing, Docker network configuration, or upstream filtering.

Run:

```bash
curl -s "http://127.0.0.1:3055/debug/diagnose?provider=musicbrainz"
curl -s http://127.0.0.1:3055/debug/upstream
scripts/proxy-diag.sh diagnose
scripts/proxy-diag.sh mb 6
scripts/proxy-diag.sh mb 4
```

Read the diagnose response this way:

- `failedStep: "dns"` means name resolution failed before a socket was opened.
- `failedStep: "tcp"` means DNS worked, but TCP/443 routing or firewalling failed.
- `failedStep: "tls"` means TCP connected, but the TLS handshake was reset or interrupted.
- `failedStep: "http"` means TLS worked, but MusicBrainz returned an HTTP error.
- `probes[]` contains side-by-side `auto`, IPv4, and IPv6 results so you can see whether only one family is broken.

Default to IPv6 first, then force IPv4 only if IPv6 is unavailable:

```env
MUSICBRAINZ_IP_FAMILY=6
```

or, only when IPv6 is unavailable:

```env
MUSICBRAINZ_IP_FAMILY=4
```

Then recreate the proxy:

```bash
docker compose up -d --force-recreate proxy
```

If MusicBrainz still fails but other providers work, you can temporarily remove MusicBrainz from active providers:

```env
METADATA_PROVIDERS=itunes,theaudiodb,discogs
PROVIDER_PRIORITY=itunes,theaudiodb,discogs,lastfm
```

This may avoid upstream-degraded readiness for MusicBrainz, but Lidarr add-artist flows may still need canonical MusicBrainz IDs.

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
curl -4 -I https://musicbrainz.org/
curl -6 -I https://musicbrainz.org/
```

From the Compose network:

```bash
docker compose run --rm --no-deps proxy node -e "require('https').get('https://musicbrainz.org/ws/2/artist/?query=test&fmt=json&limit=1',{family:4,headers:{'User-Agent':'melodarr-proxy-diag/1.0 (admin@example.com)'}},r=>{console.log(r.statusCode);r.resume()}).on('error',e=>{console.error(e.code,e.message);process.exit(1)})"
docker compose run --rm --no-deps proxy node -e "require('https').get('https://musicbrainz.org/ws/2/artist/?query=test&fmt=json&limit=1',{family:6,headers:{'User-Agent':'melodarr-proxy-diag/1.0 (admin@example.com)'}},r=>{console.log(r.statusCode);r.resume()}).on('error',e=>{console.error(e.code,e.message);process.exit(1)})"
```

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
CTID=<ctid> ./scripts/upgrade-proxmox-lxc.sh
scripts/proxy-diag.sh set-ip-family 4
scripts/proxy-diag.sh set-ip-family 6
```

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

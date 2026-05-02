# Backup And Restore

This guide explains what Melodarr Proxy stores, what needs to be backed up, how to preserve settings, how to migrate containers, and what to expect from Redis.

## What Lives In `/data`

The proxy container mounts `/data` from the Compose volume `melodarr_proxy_data`.

Current durable files:

| Path | Purpose | Back up? |
| --- | --- | --- |
| `/data/settings.json` | Admin password hash, session secret, API key hashes, runtime settings, provider credentials/tokens, custom provider mapping, saved overrides | Yes |
| `/app/data/providerMetrics.json` or configured `PROVIDER_METRICS_PATH` | Provider success/failure counters, latency metrics, scoring history | Optional |

Important details:

- API keys are only shown once when created. `/data/settings.json` stores hashes, not the original `mp_...` key values.
- Provider credentials may be stored in `/data/settings.json` if configured through Melodash runtime settings.
- Saved runtime settings override environment variables until cleared.
- The admin password itself is not stored when created through setup; only a password hash is stored.

## Redis Expectations

The bundled Redis service is cache-only and intentionally ephemeral:

```yaml
redis:
  image: redis:7-alpine
  command: ["redis-server", "--save", "", "--appendonly", "no", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
```

This means:

- Redis metadata cache is not intended to be backed up.
- Redis does not persist to disk in the default Compose file.
- Losing Redis only causes cache misses and more upstream lookups.
- The proxy falls back to in-memory cache if Redis is disconnected.
- Restoring `/data` is enough to preserve settings and API key hashes.

If you run an external Redis with persistence enabled, manage that backup separately.

## Backup: Docker Compose

Run from the project directory:

```bash
docker compose ps
docker compose stop proxy melodash
docker run --rm \
  -v melodarr_proxy_data:/data:ro \
  -v "$PWD:/backup" \
  alpine sh -c 'cd /data && tar czf /backup/melodarr-proxy-data-backup.tgz .'
docker compose up -d proxy melodash
```

Verify the backup:

```bash
tar tzf melodarr-proxy-data-backup.tgz
```

Expected important file:

```text
settings.json
```

If the volume name differs, find it with:

```bash
docker volume ls | grep melodarr
docker compose config --volumes
```

## Restore: Docker Compose

Stop the services that read `/data`:

```bash
docker compose stop proxy melodash
```

Restore into the named volume:

```bash
docker run --rm \
  -v melodarr_proxy_data:/data \
  -v "$PWD:/backup" \
  alpine sh -c 'cd /data && tar xzf /backup/melodarr-proxy-data-backup.tgz'
```

Start services:

```bash
docker compose up -d redis proxy melodash
```

Verify:

```bash
curl -s http://127.0.0.1:3055/api/health
curl -s http://127.0.0.1:3055/api/ready
docker compose logs --tail=100 proxy
```

## Backup: Proxmox LXC

Run from the Proxmox host.

Find the volume name:

```bash
pct exec <ctid> -- docker volume ls
```

Back up the default volume:

```bash
pct exec <ctid> -- bash -lc '
  cd /opt/melodarr-proxy &&
  docker compose stop proxy melodash &&
  docker run --rm \
    -v melodarr_proxy_data:/data:ro \
    -v /opt/melodarr-proxy:/backup \
    alpine sh -c "cd /data && tar czf /backup/melodarr-proxy-data-backup.tgz ." &&
  docker compose up -d proxy melodash
'
```

Copy the backup out of the LXC:

```bash
pct pull <ctid> /opt/melodarr-proxy/melodarr-proxy-data-backup.tgz ./melodarr-proxy-data-backup.tgz
```

## Restore: Proxmox LXC

Push the backup into the LXC:

```bash
pct push <ctid> ./melodarr-proxy-data-backup.tgz /opt/melodarr-proxy/melodarr-proxy-data-backup.tgz
```

Restore:

```bash
pct exec <ctid> -- bash -lc '
  cd /opt/melodarr-proxy &&
  docker compose stop proxy melodash &&
  docker run --rm \
    -v melodarr_proxy_data:/data \
    -v /opt/melodarr-proxy:/backup \
    alpine sh -c "cd /data && tar xzf /backup/melodarr-proxy-data-backup.tgz" &&
  docker compose up -d redis proxy melodash
'
```

Verify:

```bash
pct exec <ctid> -- curl -s http://127.0.0.1:3055/api/health
pct exec <ctid> -- curl -s http://127.0.0.1:3055/api/ready
pct exec <ctid> -- docker compose -f /opt/melodarr-proxy/compose.yml logs --tail=100 proxy
```

## Migrate To A New Host

1. Back up `/data` from the old host.
2. Copy `.env` or the relevant Compose environment values.
3. Install or copy the project on the new host.
4. Create the Docker network if your Compose file expects `melodarr-ipv6`:

```bash
docker network create --ipv6 --subnet fd00:dead:beef:1::/64 melodarr-ipv6
```

5. Start Redis once so the volume exists:

```bash
docker compose up -d redis
```

6. Restore the `/data` backup into `melodarr_proxy_data`.
7. Start all services:

```bash
docker compose up -d redis proxy melodash
```

8. Verify:

```bash
docker compose ps
curl -s http://127.0.0.1:3055/api/health
curl -s http://127.0.0.1:3055/api/ready
```

## Preserve Settings During Updates

Normal updates should not delete settings because `/data` is a named volume:

```bash
docker compose pull proxy melodash
docker compose up -d --force-recreate proxy melodash
```

Avoid these unless you intentionally want to erase settings:

```bash
docker compose down -v
docker volume rm melodarr_proxy_data
```

The management menu cleanup option that removes volumes will delete `/data`.

## Reset Without Full Restore

Reset the setup password when it is stored in `/data/settings.json`:

```bash
docker compose run --rm --no-deps proxy node src/server.js --reset-password
docker compose up -d proxy
```

If `ADMIN_PASSWORD` is set by environment, remove or change that environment variable instead.

Clear a saved runtime setting so env values apply again:

```bash
curl -X DELETE http://127.0.0.1:3055/api/settings/runtime/metadataProviders
curl -X DELETE http://127.0.0.1:3055/api/settings/runtime/providerPriority
```

Settings endpoints require an authenticated settings session.

## Backup Checklist

Before upgrade or migration:

- [ ] Export `/data` volume.
- [ ] Save `.env` or Compose environment values.
- [ ] Record current image tags.
- [ ] Record `docker compose ps`.
- [ ] Record `/api/health`.
- [ ] Record `/api/ready`.
- [ ] Confirm the backup archive contains `settings.json`.

After restore:

- [ ] Proxy starts.
- [ ] Melodash starts.
- [ ] `/api/health` returns ok.
- [ ] `/api/ready` is ok or only degraded for known upstream/provider reasons.
- [ ] Existing API keys still work.
- [ ] Provider settings and custom mappings appear in Melodash.

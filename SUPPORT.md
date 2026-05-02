# Support

Use this guide when asking for help with Melodarr Proxy, Melodash, or provider connectivity.

## Where To Get Help

- Open a GitHub issue for reproducible bugs, broken installs, provider failures, or documentation gaps.
- Use a feature request issue for new provider, dashboard, API, or deployment ideas.
- Do not paste API keys, admin passwords, session cookies, full `.env` files, or private reverse-proxy URLs into public issues.

Security issues should not be reported in public issues. See [SECURITY.md](SECURITY.md).

For common operator failures, see [docs/troubleshooting.md](docs/troubleshooting.md). For preserving settings or moving installs, see [docs/backup-restore.md](docs/backup-restore.md). For public hostname setup, see [docs/reverse-proxy.md](docs/reverse-proxy.md).

## Before Opening An Issue

Include the basics:

```bash
docker compose ps
docker compose logs --tail=150 proxy
docker compose logs --tail=150 melodash
curl -s http://127.0.0.1:3055/api/health
curl -s http://127.0.0.1:3055/api/ready
curl -s http://127.0.0.1:3055/api/version
```

If you use a non-default host or port, replace `127.0.0.1:3055` with your proxy URL.

Also include:

- install type: Docker Compose, Proxmox LXC, source checkout, or other
- image tags or app versions
- host OS and CPU architecture
- whether Redis, proxy, and Melodash are separate containers
- what changed immediately before the problem started

## MusicBrainz Issues

Common errors:

```text
Client network socket disconnected before secure TLS connection was established
ECONNRESET
ENETUNREACH
```

Include:

```bash
curl -s http://127.0.0.1:3055/api/ready
curl -s "http://127.0.0.1:3055/debug/diagnose?provider=musicbrainz"
scripts/proxy-diag.sh mb 4
scripts/proxy-diag.sh mb 6
docker compose logs --tail=150 proxy
```

Mention your current value for:

```env
MUSICBRAINZ_IP_FAMILY=
MUSICBRAINZ_BASE_URL=
METADATA_PROVIDERS=
```

Do not include `MUSICBRAINZ_API_KEY` unless it is redacted.

## Redis Issues

If `/api/ready` shows Redis disconnected or cache degraded, include:

```bash
docker compose ps redis
docker compose logs --tail=150 redis
docker compose logs --tail=150 proxy
curl -s http://127.0.0.1:3055/api/ready
```

Also include whether you are using the bundled Compose Redis service or an external Redis URL.

## Docker And Compose Issues

For container start, port, image, or network problems, include:

```bash
docker version
docker compose version
docker compose ps
docker compose config
docker network ls
docker compose logs --tail=150 proxy
docker compose logs --tail=150 melodash
docker compose logs --tail=150 redis
```

If the issue is image-related, include the exact image references:

```bash
docker image ls | grep melodarr
```

## Proxmox LXC Issues

For Proxmox installs or upgrades, include:

```bash
pct status <ctid>
pct config <ctid>
pct exec <ctid> -- docker ps
pct exec <ctid> -- docker compose -f /opt/melodarr-proxy/compose.yml ps
pct exec <ctid> -- curl -s http://127.0.0.1:3055/api/health
pct exec <ctid> -- curl -s http://127.0.0.1:3055/api/ready
```

If the failure happens during upgrade, include the full output from:

```bash
CTID=<ctid> ./scripts/upgrade-proxmox-lxc.sh
```

Also mention whether Docker IPv6 is enabled inside the LXC.

## Melodash Issues

For dashboard, settings, explorer, docs, or update page problems, include:

```bash
docker compose ps melodash
docker compose logs --tail=150 melodash
docker compose logs --tail=150 proxy
curl -s http://127.0.0.1:3055/api/health
curl -s http://127.0.0.1:3055/api/ready
```

Include the browser URL where the issue happens, for example:

```text
http://localhost:55026/settings
http://localhost:55026/explorer
https://melodash.example.com/dashboard
```

If Melodash says the proxy is unreachable, include your Melodash environment values with secrets removed:

```env
PROXY_API_URL=
NEXT_PUBLIC_PROXY_BASE_URL=
NEXT_PUBLIC_PROXY_FALLBACK=
```

## Provider Test Issues

For provider failures from Settings or Explorer, include:

- provider name
- query used
- basic error message
- expanded log/details panel with secrets redacted
- `/debug/providers/health`
- `/debug/providers/metrics`

Commands:

```bash
curl -s http://127.0.0.1:3055/debug/providers/health
curl -s http://127.0.0.1:3055/debug/providers/metrics
curl -s http://127.0.0.1:3055/debug/upstream
```

Redact provider tokens before posting output.

## Useful Redactions

Replace secrets like this:

```text
mp_abc123... -> mp_redacted
DISCOGS_TOKEN=... -> DISCOGS_TOKEN=redacted
LASTFM_API_KEY=... -> LASTFM_API_KEY=redacted
THEAUDIODB_API_KEY=... -> THEAUDIODB_API_KEY=redacted
MUSICBRAINZ_API_KEY=... -> MUSICBRAINZ_API_KEY=redacted
```

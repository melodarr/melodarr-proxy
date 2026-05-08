# Release Support Policy

This policy defines which Melodarr Proxy and Melodash versions are supported, when to use `latest`, how long old versions receive fixes, and how to roll back.

## Versioning

Melodarr Proxy uses semantic version-style tags:

```text
vMAJOR.MINOR.PATCH
```

Container images are published with matching tags:

```text
ghcr.io/melodarr/melodarr-proxy:<version>
ghcr.io/melodarr/melodarr-proxy-melodash:<version>
```

The `latest` tag points at the newest published release image.

## Supported Versions

Until the project reaches `v1.0.0`, support is intentionally narrow:

| Version line | Support status | Fixes |
| --- | --- | --- |
| Latest patch on the current minor line | Supported | Bug fixes, security fixes, compatibility fixes |
| Previous minor line | Limited support for 30 days after a new minor release | Critical security and upgrade-blocking fixes only |
| Older versions | Unsupported | Upgrade first before reporting bugs |

Example:

```text
Current release: v0.3.42
Supported:       v0.3.42
Limited:         latest v0.2.x, only during the 30-day grace window after v0.3.0
Unsupported:     older v0.1.x and stale v0.3 patch releases
```

Patch releases replace earlier patches on the same minor line. If you are running `v0.3.38` and `v0.3.42` exists, update to `v0.3.42` before opening a bug unless the issue is specifically that the update cannot complete.

## Should I Use `latest`?

Use `latest` when:

- this is a home lab or test install
- you want the fastest fixes
- you are using the built-in Proxmox or Compose update scripts
- you are comfortable reading the changelog before upgrading

Pin a version tag when:

- the install is used by other people
- you need repeatable rebuilds
- you run behind a public reverse proxy
- you want to schedule updates manually

Recommended production pattern:

```yaml
services:
  proxy:
    image: ghcr.io/melodarr/melodarr-proxy:v0.3.42

  melodash:
    image: ghcr.io/melodarr/melodarr-proxy-melodash:v0.3.42
```

Avoid pinning only one service. Proxy and Melodash are released together and should normally run the same tag.

## Fix Policy

Fixes are prioritized as follows:

1. Security issues
2. Broken installs or failed upgrades
3. Lidarr compatibility regressions
4. Response-shape regressions
5. Provider failures with a clear app-side cause
6. Melodash UI regressions
7. Documentation bugs

The project does not generally backport normal bug fixes to older tags. Instead, fixes land in a new patch release on the current line.

Critical security fixes may be backported to the previous minor line during its 30-day limited support window when the backport is low-risk.

## Upgrade Checks

Before upgrading:

```bash
docker compose ps
curl -s http://127.0.0.1:3055/api/health
curl -s http://127.0.0.1:3055/api/ready
```

After upgrading:

```bash
docker compose ps
curl -s http://127.0.0.1:3055/api/health
curl -s http://127.0.0.1:3055/api/ready
curl -s http://127.0.0.1:3055/api/version
```

If `/api/health` is ok but `/api/ready` is degraded, inspect the readiness details before rolling back. Provider or MusicBrainz network degradation may not be caused by the new release.

## Rollback: Docker Compose Image Install

If you use published images, roll back by pinning both images to the previous working tag.

1. Edit `docker-compose.yml` or `compose.yml`:

```yaml
services:
  proxy:
    image: ghcr.io/melodarr/melodarr-proxy:v0.3.41

  melodash:
    image: ghcr.io/melodarr/melodarr-proxy-melodash:v0.3.41
```

2. Pull and recreate:

```bash
docker compose pull proxy melodash
docker compose up -d --force-recreate proxy melodash
```

3. Verify:

```bash
docker compose ps
curl -s http://127.0.0.1:3055/api/health
curl -s http://127.0.0.1:3055/api/ready
curl -s http://127.0.0.1:3055/api/version
```

4. If the rollback fixed the issue, open a bug with:

```bash
docker compose logs --tail=150 proxy
docker compose logs --tail=150 melodash
curl -s http://127.0.0.1:3055/api/ready
```

## Rollback: Proxmox LXC Install

Run commands from the Proxmox host.

1. Inspect the deployed compose file:

```bash
pct exec <ctid> -- sed -n '1,220p' /opt/melodarr-proxy/compose.yml
```

2. Pin both images to the previous working tag:

```bash
pct exec <ctid> -- sed -i \
  -e 's#ghcr.io/melodarr/melodarr-proxy:latest#ghcr.io/melodarr/melodarr-proxy:v0.3.41#g' \
  -e 's#ghcr.io/melodarr/melodarr-proxy-melodash:latest#ghcr.io/melodarr/melodarr-proxy-melodash:v0.3.41#g' \
  /opt/melodarr-proxy/compose.yml
```

If the compose file already has a different tag, edit it manually and set both images to the same previous release.

3. Recreate the stack:

```bash
pct exec <ctid> -- bash -lc 'cd /opt/melodarr-proxy && docker compose pull proxy melodash && docker compose up -d --force-recreate proxy melodash'
```

4. Verify:

```bash
pct exec <ctid> -- docker ps
pct exec <ctid> -- curl -s http://127.0.0.1:3055/api/health
pct exec <ctid> -- curl -s http://127.0.0.1:3055/api/ready
```

## Rollback: Source Checkout Install

If you run from a git checkout:

```bash
git fetch --tags origin
git switch main
git checkout v0.3.41
yarn install --immutable
docker compose up -d --build proxy redis melodash
```

To return to normal tracking after rollback:

```bash
git switch main
git pull --ff-only
docker compose up -d --build proxy redis melodash
```

## Rollback Notes

- Roll back proxy and Melodash together.
- Do not delete the data volume unless explicitly troubleshooting corrupted settings.
- Redis cache can be cleared safely, but clearing it is not a rollback.
- If the new release changed runtime settings, review Melodash Settings after rollback.
- If the issue is only MusicBrainz connectivity, verify `MUSICBRAINZ_IP_FAMILY=6` and check IPv6 routing before rolling back.

## Reporting Problems On Older Versions

When opening an issue from an older version, include:

- why you cannot update first
- current version
- target version
- upgrade output
- `/api/health`
- `/api/ready`
- relevant proxy and Melodash logs

Issues from unsupported versions may be closed with a request to upgrade and retest.

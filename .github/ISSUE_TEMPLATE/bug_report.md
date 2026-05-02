---
name: Bug report
about: Report something that is broken
title: "[Bug]: "
labels: bug
assignees: ""
---

## Summary

What happened?

## Area

Check the area that best matches the issue:

- [ ] Proxy API
- [ ] Melodash UI
- [ ] MusicBrainz
- [ ] Other provider
- [ ] Redis/cache
- [ ] Docker Compose
- [ ] Proxmox LXC
- [ ] Lidarr compatibility
- [ ] Release/update workflow

## Steps To Reproduce

1.
2.
3.

## Expected Behavior

What did you expect to happen?

## Environment

- Install type: Docker Compose / Proxmox LXC / source / other
- Melodarr Proxy version, image tag, or commit:
- Melodash version, image tag, or commit:
- Host OS:
- CPU architecture: amd64 / arm64 / other
- Node version, if source install:
- Enabled providers:
- Reverse proxy, if any:

## Required Status Output

Paste the output. Redact secrets.

```bash
docker compose ps
```

```bash
curl -s http://127.0.0.1:3055/api/health
```

```bash
curl -s http://127.0.0.1:3055/api/ready
```

```bash
curl -s http://127.0.0.1:3055/api/version
```

If this is a Proxmox LXC install, also include:

```bash
pct exec <ctid> -- docker ps
pct exec <ctid> -- curl -s http://127.0.0.1:3055/api/health
pct exec <ctid> -- curl -s http://127.0.0.1:3055/api/ready
```

## Provider / Upstream Details

If this involves MusicBrainz or another provider, include:

```bash
curl -s "http://127.0.0.1:3055/debug/diagnose?provider=musicbrainz"
curl -s http://127.0.0.1:3055/debug/providers/health
curl -s http://127.0.0.1:3055/debug/providers/metrics
curl -s http://127.0.0.1:3055/debug/upstream
```

Provider error from Melodash, if shown:

```json
{}
```

## Logs

Paste relevant logs. Redact API keys, provider tokens, admin passwords, and cookies.

```bash
docker compose logs --tail=150 proxy
docker compose logs --tail=150 melodash
docker compose logs --tail=150 redis
```

## Screenshots

For Melodash UI issues, attach screenshots and include the URL where the issue happened.

## Additional Context

Anything else that helps explain the issue.

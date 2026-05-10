# Maintainers

This document defines project maintainers, ownership areas, and routine maintenance responsibilities.

## Current Maintainers

| Maintainer | GitHub | Areas |
| --- | --- | --- |
| Jason Walker | `@jcwalker3` | Proxy API, Melodash, release automation, docs, install scripts |

## Ownership Areas

| Area | Scope |
| --- | --- |
| Proxy API | Express routes, Lidarr/SkyHook compatibility, OpenAPI, auth, health, diagnostics |
| Provider runtime | provider adapters, aggregation, scoring, circuit breaker, recovery behavior |
| Cache | Redis integration, in-memory fallback, cache headers, cache diagnostics |
| Melodash | dashboard, settings, explorer, request traces, updates, docs UI |
| Release | versioning, changelog, tags, GHCR images, SBOM, provenance, signing, Trivy/VEX |
| Install and ops | Docker Compose, Proxmox LXC scripts, reverse proxy examples, troubleshooting |
| Branding | icons, logos, favicons, screenshots, README presentation |

CODEOWNERS is the source GitHub uses for review routing. See [.github/CODEOWNERS](.github/CODEOWNERS).

Maintainers remain the final human approver for project changes. AI role
routing can help organize research, implementation, testing, and release work,
but AI role routing does not replace CODEOWNERS review.

## Maintainer Responsibilities

Maintainers are expected to:

- keep `main` releasable
- review changes for API shape stability, install safety, and operator experience
- protect Lidarr/SkyHook response compatibility
- keep release notes and support docs current
- triage security reports according to [SECURITY.md](SECURITY.md)
- keep issue templates and support requests actionable
- avoid breaking source, Docker, GHCR, and Proxmox LXC install paths without a migration

## Adding Maintainers

A new maintainer should have a visible history of:

- useful issues, reviews, or pull requests
- understanding of the proxy response contract
- careful handling of install, security, or release changes
- respectful participation under the [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

Maintainer additions are documented in this file and in `.github/CODEOWNERS`.

## Inactive Maintainers

A maintainer may be marked inactive after sustained unavailability. Inactive maintainers can be restored when they return and confirm they want to resume review responsibility.

## Escalation

For urgent project issues:

1. Open a GitHub issue using the relevant template.
2. Include the logs and status output requested in [SUPPORT.md](SUPPORT.md).
3. For suspected vulnerabilities, do not open a public issue. Follow [SECURITY.md](SECURITY.md).

Maintainers may close issues that cannot be reproduced and do not include enough diagnostic information after a reasonable request for details.

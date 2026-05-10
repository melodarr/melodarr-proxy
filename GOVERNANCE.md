# Governance

Melodarr Proxy is maintainer-led. The project optimizes for stable self-hosted operation, Lidarr/SkyHook compatibility, and a small operational footprint.

## Project Goals

- provide a lightweight music metadata proxy for Lidarr-compatible clients
- keep response shapes stable and predictable
- support Docker, GHCR image, and Proxmox LXC installs
- make provider failures observable and recoverable
- keep Melodash useful as an operator dashboard without duplicating the proxy API

## Decision Process

Most changes are handled through normal pull request review:

1. Contributor opens an issue or pull request.
2. Maintainers review correctness, compatibility, operations impact, and tests.
3. A maintainer approves and merges when the change is ready.

Small fixes can merge with one maintainer approval.

Feature and fix work follows a `develop`-first workflow. Contributors should
start short-lived branches from `develop` and land normal feature or fix work
through a reviewed pull request back into `develop`. Protected branches,
including `main`, `develop`, `release/*`, and `rc/*`, are PR-only unless a
maintainer explicitly documents a one-time exception.

Larger changes should have an issue or design note first, especially when they affect:

- Lidarr/SkyHook response shape
- provider aggregation behavior
- circuit breaker or cache semantics
- install, update, rollback, or release behavior
- public Docker image names, ports, volumes, or environment variables
- Melodash navigation or major user workflows

## Contribution Decision Criteria

Maintainers evaluate changes against:

- Does it preserve API and response compatibility?
- Does it keep installs and upgrades understandable?
- Does it improve reliability, visibility, or maintainability?
- Does it include tests proportional to risk?
- Does it avoid making upstream provider instability worse?
- Does it keep sensitive settings, tokens, and logs safe?
- Does it fit the project scope?

Changes outside the project scope may be declined even when technically valid.

## Breaking Changes

Breaking changes are allowed only when there is a strong project reason and a migration path.

Breaking changes include:

- changing Lidarr/SkyHook response shape
- removing or renaming public endpoints
- changing default ports or required services
- changing persistent data format in `/data`
- removing environment variables without replacement
- changing image names or release tag behavior
- changing Melodash routes that users or docs rely on

Required process for breaking changes:

1. Open an issue describing the break, reason, alternatives, and migration.
2. Document the change in `CHANGELOG.md`.
3. Update README and relevant docs before release.
4. Add or update contract tests when API shape is involved.
5. Provide rollback or recovery guidance when installs are affected.

When possible, breaking changes should use a deprecation period first.

## Deprecation Policy

Deprecations should include:

- what is deprecated
- why it is deprecated
- what replaces it
- when it may be removed
- how operators can detect and migrate away from it

The proxy may keep compatibility aliases when the maintenance cost is low.

## Release Decisions

Release readiness requires:

- lint and tests passing
- Docker image builds passing
- contract tests passing
- release notes or changelog updated
- no known high-risk install regression
- no known response-shape regression for Lidarr/SkyHook clients

See [docs/release-support.md](docs/release-support.md) for supported versions and rollback guidance.

## Security Decisions

Security reports follow [SECURITY.md](SECURITY.md). Maintainers may temporarily delay public details until a fix and release are available.

## Branding Decisions

Icons, logos, favicons, app icons, screenshots, and brand naming are maintained as project assets. Changes should keep the product name `Melodarr Proxy` and dashboard name `Melodash` clear and consistent.

See [docs/branding.md](docs/branding.md).

# Security Policy

## Supported Versions

Melodarr Proxy is pre-1.0. Supported versions and fix windows are documented in [docs/release-support.md](docs/release-support.md).

Supply-chain release artifacts, SBOMs, provenance, Cosign signatures, Trivy policy, and VEX policy are documented in [docs/supply-chain-security.md](docs/supply-chain-security.md).

## Reporting a Vulnerability

Please do not open a public issue for vulnerabilities.

Send a private report to the maintainer with:

- affected version or commit
- reproduction steps
- expected impact
- any relevant logs or request examples

The maintainer will acknowledge the report, investigate, and publish a fix or mitigation when appropriate.

## Secrets

Do not commit `.env`, API keys, provider tokens, admin passwords, or session secrets. The example configuration intentionally leaves credential values blank.

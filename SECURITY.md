# Security Policy

## Supported Versions

Melodarr Proxy is pre-1.0. Security fixes are handled on the `main` branch until versioned releases are established.

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

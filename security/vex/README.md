# VEX Statements

This directory is reserved for Vulnerability Exploitability eXchange statements.

Current policy:

- Do not add VEX for findings that can be fixed by upgrading dependencies or base images.
- Do not add VEX for reachable runtime code paths.
- Add VEX only when the vulnerable code is present but demonstrably not exploitable in Melodarr Proxy or Melodash.

Every VEX statement must document:

- vulnerability id
- affected package and version
- affected image
- non-exploitability rationale
- supporting test, code inspection, or runtime evidence
- reviewer

See [../../docs/supply-chain-security.md](../../docs/supply-chain-security.md) for the full policy.

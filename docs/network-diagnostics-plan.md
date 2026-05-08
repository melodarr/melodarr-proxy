# Network Diagnostics And Transport Policy Plan

## Status

Planning document. Do not treat this as implemented behavior.

## Objective

Make Melodarr resilient and explicit about upstream network failures by adding a cached diagnostics and transport-policy layer.

The first implementation target is MusicBrainz because it is the critical metadata source and must be treated as IPv6-only for Melodarr.

## Locked Rules

- MusicBrainz is IPv6-only for this project.
- Never attempt IPv4 for MusicBrainz.
- Do not use global process hacks such as `NODE_OPTIONS=--dns-result-order=ipv4first`.
- Do not classify network health from DNS alone.
- Do not run live network probes inside hot request paths or synchronous health endpoints.
- Use cached diagnostics for `/api/health`, `/api/ready`, and Melodash.

## Problem Statement

Self-hosted environments can have misleading dual-stack behavior:

- IPv6 address exists but the route is missing.
- Only link-local IPv6 exists.
- AAAA DNS records resolve but transport fails.
- TCP connects but TLS resets.
- Docker networking differs from the LXC or host network.
- Reverse proxy failures can masquerade as provider failures.

Melodarr needs to classify these states clearly and provide operator remediation steps.

## Target Architecture

Add:

```text
src/infrastructure/network/
  network-state.js
  dns-analysis.service.js
  connectivity-probe.service.js
  transport-policy.service.js
  network-diagnostics.service.js
```

Reuse and extract generic probe logic from:

```text
src/services/diagnose.service.js
```

The current diagnose service already captures DNS, TCP, TLS, HTTP, parse, timing, and low-level socket error details. The new network layer should generalize that logic instead of creating a parallel implementation.

## Provider Transport Requirements

Create a central provider registry:

```js
{
  musicbrainz: {
    host: 'musicbrainz.org',
    path: '/ws/2/artist/?query=test&fmt=json&limit=1',
    requiredFamily: 6,
    allowFallback: false
  },
  discogs: {
    host: 'api.discogs.com',
    requiredFamily: 'auto',
    allowFallback: true
  },
  itunes: {
    host: 'itunes.apple.com',
    requiredFamily: 'auto',
    allowFallback: true
  },
  theaudiodb: {
    host: 'theaudiodb.com',
    requiredFamily: 'auto',
    allowFallback: true
  },
  lastfm: {
    host: 'ws.audioscrobbler.com',
    requiredFamily: 'auto',
    allowFallback: true
  }
}
```

MusicBrainz policy is non-negotiable:

```text
requiredFamily: 6
allowFallback: false
```

## Classification Model

Separate runtime network state from provider transport state.

### Runtime Network State

Examples:

- `IPV4_ONLY`
- `LINK_LOCAL_ONLY`
- `IPV6_NO_DEFAULT_ROUTE`
- `IPV6_GLOBAL_NO_TRANSPORT`
- `DUAL_STACK_AVAILABLE`

Runtime state is informative, not authoritative for provider availability.

### Provider Transport State

MusicBrainz states:

- `MUSICBRAINZ_IPV6_HEALTHY`
- `MUSICBRAINZ_IPV6_DNS_FAILED`
- `MUSICBRAINZ_IPV6_NO_ROUTE`
- `MUSICBRAINZ_IPV6_TCP_FAILED`
- `MUSICBRAINZ_IPV6_TLS_FAILED`
- `MUSICBRAINZ_IPV6_HTTP_FAILED`
- `MUSICBRAINZ_UNAVAILABLE`

Generic provider states:

- `HEALTHY`
- `DNS_FAILED`
- `TCP_FAILED`
- `TLS_FAILED`
- `HTTP_FAILED`
- `UNAVAILABLE`

## Probe Requirements

Each probe should record:

- DNS A and AAAA availability
- selected address
- selected family
- TCP connect result
- TLS handshake result
- HTTP status
- response parse result when applicable
- timings per phase
- low-level error fields
- checked timestamp

MusicBrainz probes must force IPv6:

```js
family: 6
```

IPv4 probe results must not be used for MusicBrainz and should not be attempted for MusicBrainz.

## Cached Diagnostics

Run diagnostics:

- at startup
- every 15 minutes
- on explicit debug refresh

Diagnostics should be cached in memory with:

- last successful state
- current state
- checked timestamp
- failure streak
- recommendation set

Do not block artist lookup, album lookup, or search on diagnostic probes.

## Transport Policy

Hot provider calls should ask the policy layer for the current transport decision.

MusicBrainz:

```json
{
  "provider": "musicbrainz",
  "policy": "ipv6_only",
  "family": 6,
  "fallbackAllowed": false
}
```

If MusicBrainz IPv6 fails:

```json
{
  "provider": "musicbrainz",
  "policy": "unavailable",
  "family": 6,
  "fallbackAllowed": false,
  "reason": "MUSICBRAINZ_IPV6_TLS_FAILED"
}
```

Other providers may later use adaptive policy:

```json
{
  "provider": "itunes",
  "policy": "ipv4",
  "family": 4,
  "fallbackAllowed": true,
  "reason": "ipv6 transport failed, ipv4 healthy"
}
```

## API Surface

Add:

```text
GET /debug/network
```

Returns detailed cached network diagnostics.

Extend:

```text
GET /api/health
GET /api/ready
```

with a compact network summary only.

Example:

```json
{
  "network": {
    "musicbrainz": {
      "policy": "ipv6_only",
      "state": "MUSICBRAINZ_IPV6_TLS_FAILED",
      "fallbackAllowed": false,
      "lastCheckedAt": "2026-05-07T16:00:00Z"
    }
  }
}
```

## Melodash Placement

Add a Melodash network diagnostics panel to the Dashboard near the existing MusicBrainz Connectivity panel.

Initial display:

- MusicBrainz policy: IPv6 only
- IPv6 address: ok/missing
- IPv6 default route: ok/missing
- DNS AAAA: ok/missing
- TCP: ok/fail
- TLS: ok/fail
- state
- last checked
- remediation steps

Future placement can add a deeper Diagnostics page, but the first version belongs on Dashboard because this is operational health.

## Remediation Guidance

Each state should include `recommendations[]`.

Examples:

### MusicBrainz IPv6 TLS Failed

```text
MusicBrainz requires IPv6. IPv6 routing is present, but TLS does not complete.
```

Recommendations:

- Test from the Proxmox host.
- Test from inside the LXC.
- Test from inside the proxy container.
- Compare `curl -6 https://musicbrainz.org/`.
- Check firewall, bridge, and LXC rules.
- Check MTU and PMTUD.
- Try another IPv6 path, VPN, or tunnel.

### IPv6 Default Route Missing

Recommendations:

- Enable IPv6 on router/ISP.
- Enable SLAAC or DHCPv6 for the LXC.
- Verify Proxmox `vmbr0` passes router advertisements.
- Restart LXC networking.

### Link Local Only

Recommendations:

- Assign a global IPv6 address.
- Enable SLAAC or static IPv6.
- Confirm `ip6=auto` or static `ip6` in `pct config`.

### Docker IPv6 Failure

Recommendations:

- Check `/etc/docker/daemon.json`.
- Enable Docker IPv6 where required.
- Recreate the Docker network.
- Recreate Compose services.

### Public `/api/*` 502

Recommendations:

- Verify `curl http://127.0.0.1:3055/api/health` from the LXC.
- Verify proxy container publishes `3055:3000`.
- Verify Melodash publishes `55026:3000`.
- Route `/api/*` and `/debug/*` to proxy, not Melodash.

## Implementation Phases

### Phase 1: MusicBrainz Diagnostics

- Extract generic probe helper from `diagnose.service.js`.
- Add MusicBrainz IPv6-only probe.
- Add cached diagnostics state.
- Add tests for DNS, TCP, TLS, HTTP, and parse states.
- Add `/debug/network`.

### Phase 2: Health And Melodash

- Add compact network summary to `/api/health` and `/api/ready`.
- Add Melodash dashboard panel.
- Display remediation guidance.

### Phase 3: MusicBrainz Hot Path Policy

- Make MusicBrainz upstream calls use central policy.
- Always force `family: 6`.
- Never fallback to IPv4.
- Surface policy state in upstream errors.

### Phase 4: General Provider Diagnostics

- Add provider registry entries for iTunes, Discogs, TheAudioDB, and Last.fm.
- Probe both families where appropriate.
- Add adaptive policy for providers that allow fallback.

### Phase 5: Operator Controls

- Add manual recheck action.
- Add diagnostics export/copy button.
- Add docs links from Melodash remediation cards.

## Testing Requirements

Unit tests:

- IPv4 only runtime
- link-local only runtime
- global IPv6 with route
- no IPv6 default route
- AAAA exists but TCP fails
- TCP connects but TLS fails
- HTTP non-2xx
- MusicBrainz never attempts IPv4
- cached health response does not trigger live probes

Integration tests:

- `/debug/network` shape
- `/api/health.network` summary shape
- Melodash panel renders healthy and failed states

## Non-Goals

- Do not change MusicBrainz to IPv4 fallback.
- Do not globally force DNS ordering.
- Do not replace existing provider health metrics.
- Do not make health endpoints slow by running live network probes.


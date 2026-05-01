# Bulletproof Canary Deployment Validation

The Melodarr Proxy deployment pipeline utilizes a strict, fail-closed canary release strategy. This ensures that new versions of the proxy are heavily validated against real-world, semantic conditions before they ever receive production traffic or replace the active container.

## Principles of the Fail-Closed Flow

1. **Isolation First:** A new image is deployed as a temporary `melodarr-proxy-canary` container alongside the active production container. Production traffic remains undisturbed during this phase.
2. **Contract Validation (Golden Query):** The canary must correctly process a standardized query (e.g., searching for "Beatles") and return a response that strictly adheres to the Lidarr SkyHook schema (`schemaVersion: skyhook-v1`, `foreignArtistId`, `images`, etc.). Simple HTTP 200 checks are insufficient.
3. **Negative Query Resilience:** The canary must correctly return an empty array `[]` when queried for non-existent or malformed terms, proving it does not crash on empty upstream responses.
4. **Offline Resilience (Cache Fallback):** The canary's outbound internet access is temporarily blocked (via internal `iptables` manipulation) to simulate a complete failure of the upstream providers (e.g., MusicBrainz, Tidal, Fanart). The proxy MUST gracefully serve cached data and return a valid HTTP 200 response.
5. **Atomic Promotion:** Only if ALL the above checks pass sequentially is the existing production container removed, and the canary renamed and promoted to take its place.
6. **Post-Promotion Verification:** After promotion, a final health check ensures the newly promoted container is successfully receiving requests on the designated production port.

If **ANY** of the validation steps fail, the deployment is instantly aborted. The canary container is destroyed, and the existing production container continues serving requests without interruption. This guarantees 100% contract compliance and system stability across every update.

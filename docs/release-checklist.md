# Melodarr Proxy v1.0 Release Checklist

This document serves as the standard operating procedure for verifying the production-readiness of the Melodarr Proxy system prior to any major deployment.

## 1. Environment Configuration Validation
- [ ] Ensure `.env` is created from `.env.example`.
- [ ] Verify `UPSTREAM_URL` is set to the correct MusicBrainz endpoint (e.g., `https://musicbrainz.org`).
- [ ] Confirm `REDIS_URL` points to an active Redis instance. If absent, understand that the system will fallback to in-memory caching.
- [ ] Validate standard application identity variables (`APP_NAME`, `APP_VERSION`, `APP_CONTACT`) are correctly populated.

## 2. Startup & "Fail-Fast" Boot Sequence
- [ ] Start the application via `npm start` or Docker Compose.
- [ ] Verify boot logs confirm the connection to the Upstream API.
- [ ] Verify boot logs confirm the state of the Redis connection.
- [ ] Ensure the process intentionally exits (code `1`) if `UPSTREAM_URL` is missing or unreachable.

## 3. Rate Limiting & Abuse Protection
- [ ] Verify that the proxy endpoints (`/api/search`, `/api/v1/artist/lookup`) correctly employ rate limiting.
- [ ] Send 61 rapid requests to the `/api/search` endpoint and ensure the 61st receives an HTTP 429 "Too many requests" response.

## 4. Deep Health Endpoint Diagnostics
- [ ] Query `GET /api/health` and verify the `status` reflects the combined health of the components.
- [ ] Confirm the deep memory check reports `memory.status` as `ok`.
- [ ] Verify `upstream` and `cache` fields accurately reflect connectivity states.

## 5. Metrics History & Telemetry
- [ ] Ensure `GET /api/stats` returns real-time traffic statistics.
- [ ] Ensure `GET /api/stats/history` returns the sliding window of snapshots (up to 10 latest snapshots per minute).

## 6. Frontend Configuration Verification
- [ ] Access the Settings UI (dashboard).
- [ ] Test the new product name history pills; verifying you can switch back to previously generated names smoothly.
- [ ] Ensure the login/logout cycle accurately handles token management and redirects to `login.html` upon session termination.

## 7. Quality Assurance
- [ ] Run `npm run lint` and ensure there are no formatting or syntax warnings (`standard` compliance).
- [ ] Test the Docker build process to ensure the container wraps successfully and dependencies are securely installed.

If all the above pass successfully, the deployment is considered trustworthy and certified for release.

# Open Source Readiness Tracker

This file tracks the work needed to make Melodarr Proxy easy to run, contribute to, and trust.

## Completed

- [x] Add Yarn-based local workflow.
- [x] Add CI for lint, tests, and Docker image builds.
- [x] Document provider configuration.
- [x] Add provider visibility to lookup responses and stats.
- [x] Add Docker health checks.
- [x] Move optional Compose services behind profiles.
- [x] Add random host ports for optional services.
- [x] Add persistent API-key authentication for Lidarr-facing endpoints.
- [x] Replace comma-separated provider settings with UI checkboxes.
- [x] Add API documentation.
- [x] Add Lidarr compatibility documentation.
- [x] Add Dependabot configuration.
- [x] Add `.dockerignore`.
- [x] Run production container as non-root.
- [x] Add GHCR image publishing workflow.

## Next

- [ ] Stabilize the `/api/v1/artist/lookup` response contract.
- [ ] Add per-provider test buttons on the settings page.
- [ ] Add release workflow and release notes automation.
- [ ] Add cached lazy artwork endpoints.
- [ ] Add integration tests for cache hits, partial provider failure, and auth setup.
- [ ] Test against a real Lidarr instance and document compatibility gaps.

## Later

- [ ] Split optional Auth and DevDash services if they grow beyond this project.
- [ ] Add background cache warming.
- [ ] Add stricter provider result ranking and filtering.

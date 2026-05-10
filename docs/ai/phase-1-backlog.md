# Phase 1 AI Backlog

This backlog is intentionally limited to operating-model hardening. It does not
propose runtime behavior changes.

## Align CI with develop

Ensure GitHub Actions and branch rules consistently validate pull requests into
`develop`. Risk: CI branch coverage can drift from the documented branch policy.

## Stabilize artist lookup contract

Keep artist lookup fixtures, source-derived contract checks, and Lidarr
compatibility docs aligned. Risk: release doc drift can hide response-shape
regressions.

## Add provider test actions in Melodash

Make provider test actions easy to verify from Melodash without exposing secrets
or changing provider runtime behavior. Risk: single-maintainer review load can
miss UI/backend contract mismatches.

## Expand integration coverage for cache, partial failure, and auth

Add focused integration coverage for cache behavior, provider partial failure,
and API-key/no-key auth modes. Risk: cross-doc process drift can let install
and runtime assumptions diverge.

## Automate release notes from merged changes

Improve release-note preparation from merged pull requests while keeping final
maintainer review in control. Risk: generated notes can become misleading when
not checked against actual release scope.

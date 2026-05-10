# Phase 1 Operating Model

This document is the canonical source for Melodarr's Phase 1 AI-assisted
operating model. It defines how agents can help while preserving the
maintainer-led workflow, CODEOWNERS-backed review, and protected-branch rules.

## Operating Principles

- Feature and fix branches start from `develop`.
- Protected branches receive changes only through reviewed pull requests.
- AI agents may research, implement, test, and document work, but maintainers
  remain responsible for final approval.
- Lidarr/SkyHook response shapes, provider aggregation, cache semantics, install
  flows, release behavior, and security-sensitive settings are high-risk areas.
- Agent work must stay file-scoped. Shared files are sequenced rather than
  edited by parallel workstreams.

## Lifecycle Workflow

1. Intake clarifies the user goal, affected areas, target branch, and proof
   required before merge.
2. Planning decomposes work into non-overlapping file ownership and identifies
   validation gates.
3. Implementation applies scoped changes in short-lived branches.
4. Review checks correctness, compatibility, and docs impact before maintainer
   review.
5. Quality Assurance runs the required gates for the changed surface.
6. Release confirms version, changelog, deployment, and rollback impact.

## Role Handshakes

Each role must pass explicit context to the next role:

- Project Manager to Senior Developer: scope, acceptance criteria, target
  branch, and risk areas.
- Senior Developer to implementation roles: file ownership, dependencies,
  validation gates, and contract constraints.
- Implementation roles to Quality Assurance: changed files, behavior impact,
  and tests already run.
- Quality Assurance to Release Manager: gate results, residual risk, and
  release-note requirements.
- Release Manager to Maintainer: merge readiness, deployment notes, and rollback
  guidance.

## Quality Gates

Baseline gates are defined in [docs/ai/quality-gates.md](quality-gates.md).
Contract-sensitive changes add `yarn test:contracts`. Install/runtime changes
add `yarn test:compose`. Melodash route changes add `yarn test:melodash-routes`.

Agents must report the exact failing command when a gate fails and stop before
expanding scope.

## Backlog Seed

The Phase 1 seed backlog is defined in [docs/ai/phase-1-backlog.md](phase-1-backlog.md).
It starts with CI alignment, artist lookup contract stability, provider test
actions in Melodash, integration coverage for cache/partial failure/auth, and
release-note automation.

## Guardrails

- Do not fabricate Lidarr queue or release runtime state from metadata.
- Do not change public response shape without source-derived contract tests.
- Do not hide provider failures behind generic success states.
- Do not commit directly to protected branches.
- Do not expose API keys, provider tokens, cookies, or admin secrets in logs,
  docs, fixtures, screenshots, or agent output.
- Do not let generated docs override `GOVERNANCE.md`, `BRANCH_RULES.md`,
  `MAINTAINERS.md`, or CODEOWNERS.

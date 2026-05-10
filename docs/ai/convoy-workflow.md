# AI Convoy Workflow

This workflow defines how Melodarr uses AI-assisted roles without changing the
repository's maintainer-led review model.

## Intake

The CTO and Project Manager clarify the request, confirm the target branch, and
identify whether the work belongs in the current phase. Intake should capture
the user goal, affected areas, known risks, and required proof.

## Planning

The Senior Developer decomposes the work into file-safe tasks. Parallel
workstreams must not share files. Shared-file work is sequenced into a later
phase so agents do not overwrite each other or create merge drift.

## Implementation

Backend Developer and Frontend Developer agents implement scoped changes in
their owned files. Documentation Writer handles operator-facing updates when the
change affects setup, release flow, contracts, or troubleshooting.

## Review

Senior Developer and Reviewer agents inspect correctness, file ownership,
contract impact, and unintended behavior changes before maintainer review.

## Quality Assurance

Quality Assurance verifies the required gates for the touched area. Contract,
install/runtime, and Melodash route changes must add the extra focused checks
listed in `docs/ai/quality-gates.md`.

## Release

The Release Manager confirms release readiness, changelog or release-note
impact, deployment notes, and rollback guidance before merge or tagging.

## Recommended Handoff Order

1. CTO and Project Manager for intake.
2. Senior Developer for decomposition and file partitioning.
3. Backend Developer and Frontend Developer for implementation.
4. Documentation Writer for operator-facing updates.
5. Quality Assurance for verification.
6. Release Manager for release readiness.

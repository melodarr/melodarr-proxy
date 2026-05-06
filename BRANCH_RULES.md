# Branch Rules

This file is the repository branch policy for humans and LLM coding agents.
When branch instructions conflict with a local request, follow this file unless
the repository maintainer explicitly overrides it in the current task.

## Protected Branches

The following branches must not receive direct commits:

- `main`
- `develop`
- `release/*`
- `rc/*`

Do not commit directly to these branches. Do not force-push them. Do not rewrite
their history.

All changes must land through a pull request from a short-lived working branch.

## Branch Roles

`main`

- Production-ready branch.
- Represents the latest stable release.
- Receives completed releases through reviewed pull requests only.
- Tags such as `v0.4.0` are cut from this branch unless maintainers specify
  otherwise.

`develop`

- Primary integration branch for ongoing feature development.
- New feature branches should usually start from `develop`.
- Receives feature and fix work through reviewed pull requests only.
- Must stay deployable enough for integration testing.

`rc/vX.Y.Z`

- Release candidate branch for the next planned version.
- Created from `develop` when a release is being stabilized.
- Accepts only release stabilization fixes, validation updates, and release
  documentation through reviewed pull requests.
- Must not accept unrelated features.

`release/vX.Y.Z`

- Final release branch for version `vX.Y.Z`.
- Used for final validation, release-specific fixes, and tagging.
- After release, merge or PR the finalized release back to `main`, and backport
  any required fixes to `develop`.

`feature/*`, `fix/*`, `chore/*`, `docs/*`, `codex/*`

- Short-lived working branches.
- Safe place for direct local commits.
- Push to origin and open a pull request into the appropriate target branch.
- Delete after merge when no longer needed.

## Required Workflow

Before editing files:

1. Run `git status --short --branch`.
2. If currently on `main`, `develop`, `release/*`, or `rc/*`, create or switch
   to a short-lived working branch.
3. Base the working branch on the intended target branch.

Target branch selection:

- New feature: branch from `develop`, PR into `develop`.
- Bug fix for unreleased work: branch from `develop`, PR into `develop`.
- Release candidate fix: branch from `rc/vX.Y.Z`, PR into `rc/vX.Y.Z`.
- Final release fix: branch from `release/vX.Y.Z`, PR into `release/vX.Y.Z`.
- Production hotfix: branch from `main`, PR into `main`, then backport to
  `develop` and any active release branch.
- Documentation-only policy/update: branch from the branch that owns the policy
  change, usually `main`, then PR into that branch.

Before pushing:

1. Run focused tests for touched code.
2. Run lint or formatting checks required by the touched package.
3. Run `git status --short --branch` and verify only intended files changed.
4. Push the working branch, not a protected branch.

## LLM Agent Rules

An LLM agent must:

- Treat this file as durable repository policy.
- Refuse to commit directly to `main`, `develop`, `release/*`, or `rc/*` unless
  the maintainer explicitly instructs a one-time exception.
- Prefer a `codex/*` branch for agent-authored work unless the user asks for a
  different short-lived branch name.
- Preserve user changes and never reset or overwrite unrelated work.
- Explain any branch mismatch before moving commits or changing branch bases.
- Avoid force pushes unless explicitly requested by the maintainer for a
  specific branch and commit range.

## Recovery Rules

If work accidentally happens on a protected branch:

1. Stop before committing.
2. Create a short-lived branch from the current state.
3. Commit there.
4. Restore the protected branch to its remote tracking branch only after
   confirming no user work will be lost.

If a protected branch push is rejected:

1. Do not force push.
2. Fetch the remote.
3. Rebase or merge the working branch onto the updated target.
4. Re-run validation.
5. Push the working branch and update the pull request.

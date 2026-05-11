# OpenCastle Claude Adapter Routing Validation Report

## Detected adapter

The established, tracked-looking adapter wiring visible in this worktree is Gemini. Claude wiring is present only as untracked local symlinks/directories and a local Claude settings file with a bash allowlist, so Claude routing is not validated from this worktree.

`.opencastle/` resolves to `/Users/jasonwalker/Development/melodarr-opencastle/.opencastle/`. That path is outside the session sandbox for this task, so the upstream OpenCastle adapter registry cannot be inspected from this worktree.

| Path | Evidence | Finding |
| --- | --- | --- |
| `.opencastle` | `readlink .opencastle` | Symlink target: `/Users/jasonwalker/Development/melodarr-opencastle/.opencastle` |
| `.gemini` | `readlink .gemini` | Symlink target: `/Users/jasonwalker/Development/melodarr-opencastle/.gemini` |
| `GEMINI.md` | `readlink GEMINI.md` | Symlink target: `/Users/jasonwalker/Development/melodarr-opencastle/GEMINI.md` |
| `CLAUDE.md` | `ls -la`, `readlink CLAUDE.md`, `git status --short` | Present as an untracked symlink. Target: `/Users/jasonwalker/Development/melodarr-opencastle/CLAUDE.md` |
| `.claude/` | `ls -la .claude` | Contains `settings.local.json`; untracked symlinks for `agents`, `prompts`, `skills`, and `workflows`; no `hooks` entry. Symlink targets point under `/Users/jasonwalker/Development/melodarr-opencastle/.claude/` and were not followed. |
| `.claude/settings.local.json` | `cat .claude/settings.local.json` | Contains only `permissions.allow` entries for bash commands. No `hooks`, no `permissions.deny`, and no OpenCastle environment wiring were present in the file read. |

Additional `.claude/` checks:

| Path | Evidence | Finding |
| --- | --- | --- |
| `.claude/agents` | `ls -la .claude/agents` | Present as untracked symlink to `/Users/jasonwalker/Development/melodarr-opencastle/.claude/agents`; target contents unverified. |
| `.claude/skills` | `ls -la .claude/skills` | Present as untracked symlink to `/Users/jasonwalker/Development/melodarr-opencastle/.claude/skills`; target contents unverified. |
| `.claude/hooks` | `ls -la .claude/hooks` | Absent: command returned `No such file or directory`. |

## Branch

| Item | Evidence | Finding |
| --- | --- | --- |
| Current branch | `git rev-parse --abbrev-ref HEAD` | `feat/49-image-deduplication` |
| `origin` remote | `git remote get-url origin` | `https://github.com/melodarr/melodarr-proxy.git` |
| Status summary | `git status --short --branch` | Current branch has 1 modified path and 15 untracked paths before this report update. Modified: `.claude/settings.local.json`. Untracked: `.claude/agents`, `.claude/prompts`, `.claude/skills`, `.claude/workflows`, `CLAUDE.md`, several `docs/` paths, one script, and two `src/` paths. |

`BRANCH_RULES.md` says protected branches include `main`, `develop`, `release/*`, and `rc/*`; all changes land through pull requests from short-lived branches. For feature work, new branches should usually start from `develop` and PR into `develop`, so convoy work should land on a feature branch off `develop`, not on `develop` directly.

## Validation commands

The following commands are documented from `package.json` `scripts`; none were run for this validation.

| Script | Command |
| --- | --- |
| `lint` | `XDG_CACHE_HOME=.cache standard` |
| `test:unit` | `find src -name '*.test.js' -not -path 'src/e2e/*' -print0 \| xargs -0 node --test --test-force-exit` |
| `test` | `node --test src/**/*.test.js` |
| `test:coverage:check` | `c8 --check-coverage --lines 85 --branches 80 --functions 85 --statements 85 node --test src/**/*.test.js` |
| `test:contracts` | `node --test src/contracts/**/*.test.js` |
| `test:e2e` | `node --test src/e2e/**/*.e2e.test.js` |
| `test:e2e:real` | `E2E_REAL_HTTP=true node --test src/e2e/**/*.e2e.test.js` |
| `test:compose` | `bash scripts/docker-compose-smoke.sh` |
| `test:lidarr-smoke` | `bash scripts/lidarr-add-artist-smoke.sh` |
| `test:melodash-routes` | `bash scripts/melodash-route-smoke.sh` |
| `docker:lint` | `bash scripts/docker-compose-run.sh --profile test run --rm test yarn lint` |
| `docker:test` | `bash scripts/docker-compose-run.sh --profile test run --rm test sh -c 'yarn test && yarn test:e2e'` |

Coverage thresholds in `test:coverage:check` are lines 85, branches 80, functions 85, and statements 85.

Husky setup is present: `package.json` has `"prepare": "husky"`, so Husky runs on install. `.husky/` contains a `pre-commit` hook, and `cat .husky/pre-commit` shows it runs `yarn lint` and `yarn test:unit`.

## Missing setup to route work through a Claude adapter

1. `CLAUDE.md` is not absent in the filesystem; it is present as an untracked symlink to `/Users/jasonwalker/Development/melodarr-opencastle/CLAUDE.md`. Because the target is outside the task sandbox and was not read, the target contents and adapter behavior are unverified.
2. `.claude/agents/` and `.claude/skills/` are not absent in the filesystem; they are present as untracked symlinks to upstream paths that were not followed. `.claude/hooks/` is absent. This means the Claude OpenCastle scaffolding visible here is partial and unverified.
3. `.claude/settings.local.json` has no `SessionStart` or `UserPromptSubmit` OpenCastle hooks. It also has no `permissions.deny` and no OpenCastle environment wiring; it only contains a bash allowlist under `permissions.allow`.
4. The upstream adapter registry is not verified. The `.opencastle` symlink target points outside this worktree to `/Users/jasonwalker/Development/melodarr-opencastle/.opencastle/`.
5. The session/task sandbox boundary blocks validation reads of `/Users/jasonwalker/Development/melodarr-opencastle/**` for this report, so all claims about upstream Claude adapter contents remain explicitly unverified.

## Recommended next steps (no edits performed)

- Open a Claude Code session rooted at `/Users/jasonwalker/Development/melodarr-opencastle` to inspect `.opencastle/adapters/`.
- If a Claude adapter exists upstream, mirror the Gemini symlink pattern here with `CLAUDE.md` plus any required `.claude/` paths.
- If no Claude adapter exists upstream, author it in `melodarr-opencastle` first.
- Re-run this validation once symlinks are in place.
- Success means `generate-convoy` here detects `adapter=claude`.

## Result

**Routing work through a Claude adapter is not currently verified as possible from this worktree; it is unblocked by validating or authoring the upstream Claude adapter under `melodarr-opencastle`, then completing the Claude symlink and hook wiring here.**

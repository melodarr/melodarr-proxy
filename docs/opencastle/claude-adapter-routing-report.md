# OpenCastle Claude Adapter Routing Validation

Planning-only validation report for `lidarr-lite-proxy` / Melodarr proxy.

## Detected adapter

Gemini is wired in this worktree. Claude is not wired as an OpenCastle adapter surface here.

| Path | Observed state | Evidence |
|---|---|---|
| `.opencastle` | Symlink | Resolves to `/Users/jasonwalker/Development/melodarr-opencastle/.opencastle`. |
| `.gemini` | Symlink | Resolves to `/Users/jasonwalker/Development/melodarr-opencastle/.gemini`. |
| `GEMINI.md` | Symlink | Resolves to `/Users/jasonwalker/Development/melodarr-opencastle/GEMINI.md`. |
| `CLAUDE.md` | Absent | `test -e CLAUDE.md` returned absent. No Claude counterpart is linked into this worktree. |
| `.claude/` | Local directory | Contains only `settings.local.json`; no `.claude/agents/`, `.claude/skills/`, or `.claude/hooks/` directories are present. |
| `.claude/settings.local.json` | Bash allowlist only | Contains `permissions.allow` entries for Bash commands. It does not contain `hooks`, `permissions.deny`, or OpenCastle environment wiring. |

`.opencastle/` resolves to `/Users/jasonwalker/Development/melodarr-opencastle/.opencastle/`. That path is outside the Melodarr repo and outside this session's writable sandbox boundary, so the upstream adapter registry was not treated as verified from this worktree. The symlink topology visible from the repo shows Gemini wiring, not Claude wiring.

## Branch

| Field | Value |
|---|---|
| Current branch | `develop` |
| Origin remote | `https://github.com/melodarr/melodarr-proxy.git` |
| Branch policy | `BRANCH_RULES.md` says direct commits to `develop` are prohibited and new feature branches should usually start from `develop`. It also says agent-authored work should prefer a short-lived branch, commonly `codex/*`, unless instructed otherwise. |

Current `git status --short` summary before this report was written:

```text
 M .claude/settings.local.json
 M .github/workflows/pre-release.yml
 M melodash/app/settings/components/JsonTree.tsx
 M src/providers/index.js
 M src/providers/index.test.js
 M src/utils/lidarrArtist.js
?? docs/architecture/
?? docs/compatibility-matrix.md
?? docs/contracts/
?? docs/fixtures/
?? docs/lidarr-source-map.md
?? docs/regressions/
```

Convoy implementation work should land on a feature branch off `develop`, not directly on `develop`.

## Validation commands

The following scripts were extracted from `package.json` without running them.

| Script | Command |
|---|---|
| `lint` | `XDG_CACHE_HOME=.cache standard` |
| `test:unit` | `find src -name '*.test.js' -not -path 'src/e2e/*' -print0 | xargs -0 node --test --test-force-exit` |
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

The coverage gate uses these thresholds: lines 85, branches 80, functions 85, statements 85.

`package.json` also defines `prepare` as `husky`. The `.husky/` directory contains a top-level `pre-commit` hook, and that hook runs:

```sh
yarn lint
yarn test:unit
```

## Missing setup to route work through a Claude adapter

1. `CLAUDE.md` is absent. There is no symlink mirroring the existing `GEMINI.md` pattern.
2. `.claude/agents/`, `.claude/skills/`, and `.claude/hooks/` OpenCastle scaffolding are absent. The `.claude/` directory currently contains only `settings.local.json`.
3. `.claude/settings.local.json` does not define `SessionStart` or `UserPromptSubmit` OpenCastle hooks.
4. The upstream adapter registry was not verified from this worktree. The visible local wiring indicates Gemini, but it does not prove whether a Claude adapter exists upstream.
5. The sandbox boundary blocks treating `/Users/jasonwalker/Development/melodarr-opencastle/**` as part of this repo's editable workspace. Upstream adapter inspection should happen from a session rooted at `/Users/jasonwalker/Development/melodarr-opencastle` or one explicitly granted access to it.

## Recommended next steps (no edits performed)

- Open a Claude Code session rooted at `/Users/jasonwalker/Development/melodarr-opencastle` to inspect `.opencastle/adapters/` or the equivalent adapter registry.
- If a Claude adapter exists upstream, mirror the Gemini symlink pattern in this repo with `CLAUDE.md` and any required `.claude/` paths.
- If no Claude adapter exists upstream, author it in `melodarr-opencastle` first.
- Re-run this validation once the Claude symlinks are in place.
- Treat success as `generate-convoy` in this repo detecting `adapter=claude`.

## Result

**Routing through a Claude adapter is not currently possible from this worktree; Gemini is the adapter surface that is wired, and Claude routing is blocked until upstream Claude adapter scaffolding is verified and mirrored into this repo.**

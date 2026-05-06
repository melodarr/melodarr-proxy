# Changelog

All notable changes to Melodarr Proxy will be documented here.

## v0.4.0 - 2026-05-06

- **Production Hardening & Reliability:** Introduced robust traffic control and stability mechanisms.
- **Global Concurrency Limiter:** Added new middleware to restrict maximum simultaneous inflight requests (`MAX_CONCURRENT_REQUESTS=20` default). Returns `503 Service Unavailable` with a descriptive message if the server is saturated.
- **Global Rate Limiter:** Added IP-based global rate limiting (`GLOBAL_RATE_LIMIT_MAX=500` default over a 60s window) to prevent abusive scraping across endpoints.
- **Strict Server Timeouts:** Implemented strict HTTP request and response timeouts (`SERVER_TIMEOUT_MS=15000` default) at the app level. Disconnects hung clients (408 Request Timeout) and returns `504 Gateway Timeout` when server-side processing exceeds the configured deadline; this enforces response deadlines but does not by itself imply automatic cancellation of already-started upstream work.
- **Upstream Connection Pooling & Queuing:** Overhauled `upstream.service.js` with an asynchronous waiting queue (max 3 concurrent outbound requests) and global interval pacing. Protects upstream APIs from being blasted by parallel proxy requests.
- **Configuration Overhaul:** All new limits are exposed via environment variables and overrideable dynamically at runtime via the Settings API.
- **Linting & Code Quality:** Resolved lingering `standard` lint errors across multiple files including `server.js`, `upstream.service.js`, and `startupValidator`.

## v0.3.42 - 2026-05-01

- **Final validation gate before responses reach Lidarr.** New `src/utils/validateArtist.js` exports `isValidArtist(item)` — returns `false` for items whose display field (`artistName` for wrapped artists / unwrapped lookup, `title` for wrapped albums) is missing, empty, or whitespace-only. Applied as a `.filter()` immediately after every `toSkyhookSearchShape()` in `proxy.controller.js`'s `handleSearch` (cache hit, coalesce hit, fresh fetch) and `handleArtistDiscover`, plus the success paths of `handleArtistLookup`. Drops broken items rather than passing them through; never modifies fields.
- **No fabricated IDs.** The validator deliberately does NOT check `foreignArtistId`. Empty MBID is a legitimate signal from a non-MB provider; synthesizing fake values to pass validation would let Lidarr add artists into its library that subsequently fail every metadata refresh (Lidarr keys downstream operations on `foreignArtistId` as a canonical MusicBrainz UUID — an invented value has no upstream resolution path and creates a permanent broken-state row that requires manual deletion). Keeping the field truthful is the deliberate trade.
- 14 new unit tests in `src/utils/validateArtist.test.js` covering: null/undefined/non-object inputs, empty `{}`, wrapped artist with valid/empty/whitespace/null `artistName`, wrapped artist with empty `foreignArtistId` (still valid — explicit guard against accidental tightening), wrapped album with valid/empty/missing `title` (regression test for the spec's combined-check bug that would have rejected all albums because `undefined == null`), unwrapped lookup-shape artist, hybrid wrap+unwrapped object, non-object `.artist` value.
- **Bug-fix vs. literal spec:** the spec's combined check `if (a.artistName === "" || a.artistName == null) return false` would silently reject every album result, because the inner album object has no `artistName` field — `undefined == null` is `true`. Implementation uses branch-specific validation (artist branch → check `artistName`; album branch → check `title`; lookup-shape branch → check top-level `artistName`).
- **Lookup endpoint shape note:** lookup returns `[{...flat artist...}]`, not wrapped. The validator's third branch handles this. Error paths in lookup (502 with `partial: true, warning: ...`) are intentionally NOT filtered — operators rely on those structured errors as diagnostics rather than seeing a silent empty array.
- No application code changes outside the controller wiring + new utility. Provider behavior, fallback chain, retry/rate-limit, response shape (other than dropping invalid items) all unchanged.

## v0.3.41 - 2026-05-01

- **`scripts/site-tests.sh` — simplified API key handling.** When `API_KEY` is not set via env, the wizard now prompts once for it. If it remains empty after the prompt, the script aborts with a clear `ERROR: API key is required` message instead of silently running unauthed and failing every auth-gated test with 401. CI (`INTERACTIVE=0`) still relies on the env var.
- Removed the in-progress ephemeral admin-generated key path that briefly landed on `main` — the proxy uses single-factor `x-api-key` header auth, so the simpler "set-or-prompt" handling is sufficient. No session cookie, no admin login, no cleanup trap, no calls to `/api/settings/login` or `/api/admin/keys/create` from the harness.
- No application code changes. Only `scripts/site-tests.sh` + release plumbing.

## v0.3.40 - 2026-05-01

- **Persistent provider metrics across restarts.** `data/providerMetrics.json` is loaded asynchronously at module init and saved via a debounced `setTimeout` (default 30s window, configurable via `PROVIDER_METRICS_SAVE_MS`). The hot path (`record()`) does NOT pay sync I/O cost — every record arms the timer if not already armed; one timer fires regardless of call volume. The save timer is `unref()`-ed so it never keeps the event loop alive. Failures (missing file, parse error, perms) are silent — the in-memory map stays empty and the proxy proceeds with fresh state.
- **Time-based decay (read-only).** `computeScore` clones the metric, applies `0.98^minutes-since-lastDecayAt` to both `success` and `failure` counters on the clone, and computes the score from the decayed view. The original metric is never mutated by `computeScore` — `sortByScore` (called on every `aggregateArtist`) gets stable values across consecutive reads in the same tick. Honest documentation: uniform decay preserves successRate, so the score doesn't actually demote stale-but-historically-successful providers via the score path. Decay is observable in raw counter magnitude (visible via the new `/debug/providers/metrics` endpoint) but the practical scoring effect is muted. Revisit as a v0.3.41 followup.
- **Scoring formula simplified.** Dropped the freshness component (was 0.2 weight). New formula: `successRate*0.5 + latencyScore*0.5`. Latency now defaults to 1000ms when no samples exist (legacy default) so a cold provider scores 0.25 instead of the prior 0.3. Internal change only — no API response shape impact.
- **New endpoint `GET /debug/providers/metrics`** — side-by-side raw vs decayed counters, plus the computed score, per provider. Designed for production debugging of the persistence + decay subsystem so operators can SEE what decay is doing to ranking inputs. Read-only.
- **Slack alerting on provider-disabled transition.** New `src/alerts/alertService.js` with `sendAlert(msg)` (fire-and-forget) and `sendSlack(msg)` (awaitable, internal). Built-in `fetch` (Node 18+); no `node-fetch`, no `nodemailer`, no new dependencies. Triggered exclusively from the existing `wasNotDisabled` branch in `providerHealth.recordFailure` — same guard prevents alert spam during sustained outages. `ALERT_SLACK_WEBHOOK` env var; if unset, sendAlert is a silent no-op. Network/HTTP errors during send are caught and logged at WARN, never propagated.
- 16 new tests: 4 in `providerMetrics` (purity, applyDecay magnitude, decay-preserves-rate documentation, persistence roundtrip via subprocess, corrupt-file no-crash, missing-file no-crash, score-formula updates), 6 in `alertService` (no-op without env, POSTs JSON, logs warn on non-2xx, logs warn on network error, fire-and-forget never throws, no crash without env), 3 in `providerHealth` (alert fires once on transition, no spam, message content), 6 in `debug.metrics` (empty state, raw+decayed+score surface, decay shrinks decayed counters, multi-provider, no-mutation, response shape contract).
- **Untouched:** API response shapes, `proxy.controller.js`, `skyhook.js`, fallback chain order, retry/rate-limit, the v0.3.39 auto-reenable behavior. The `/debug/providers/health` endpoint added in v0.3.39 is unchanged; the new `/debug/providers/metrics` is a sibling.
- **Known design limitation (acknowledged):** uniform decay preserves successRate. Future revisit options on the table for v0.3.41: decay timing (apply before record), asymmetric decay (e.g., decay successes faster than failures), or confidence-based scoring.

## v0.3.39 - 2026-05-01

- **Provider visibility — operator can now see what the circuit breaker is doing.** New endpoint `GET /debug/providers/health` returns per-provider live state (status, failures, success/failure counts, avgLatency, score, lastSuccess/lastFailure). Distinct from the existing `/debug/providers` (which serves the active-providers config list — unchanged). Read-only; never mutates health or metrics state.
- **Env-configurable circuit breaker thresholds.** `PROVIDER_FAILURE_THRESHOLD` (default `3`) and `PROVIDER_COOLDOWN_MS` (default `600000` = 10 minutes) are now read at module load with strict validation: negative or non-numeric values throw at boot rather than silently misconfiguring. Defaults preserve v0.3.38 behavior exactly.
- **Auto-reenable via success streak.** A disabled provider is no longer restored by a single canary success — it now requires `PROVIDER_REENABLE_SUCCESS_THRESHOLD` consecutive successes (default `3`) within `PROVIDER_REENABLE_WINDOW_MS` (default `300000` = 5 minutes). Successful canary attempts accumulate in a sliding window; failures reset the streak. On reenable, status transitions to `degraded` (not `healthy`) so subsequent failures put it back to `disabled` quickly. Logs a single INFO line `Provider auto-reenabled after success streak` on the transition. This replaces the v0.3.38 single-canary-restores behavior — sustained recovery is now required before the breaker closes.
- New `_getAllNames()` internal export on `providerHealth` and `providerMetrics` so the new endpoint can union both maps without exposing the maps themselves to consumers.
- Test additions: 6 tests for `getProvidersDebug`, 6 tests for ENV config (defaults still apply, custom threshold respected, custom cooldown respected, invalid threshold throws, negative threshold throws, negative cooldown throws), 4 tests for the new auto-reenable behavior (3-success streak triggers reenable to `degraded`; spaced-out successes outside the window do NOT reenable; failures interrupting the streak prevent reenable; failures resuming after reenable return to `disabled`). All ENV / spawn tests use `child_process.spawnSync` for deterministic module-load isolation.
- **No changes to:** scoring formula, provider behavior, response shapes of any existing endpoint, fallback chain order, retry/rate-limit policy. Pure additive observability + configurability release.

## v0.3.38 - 2026-05-01

- **Resilient adaptive provider system.** Adds a per-provider circuit breaker, EWMA-based scoring, and shape validation around every aggregation call. No API or response-shape changes — all surfaces (including the v0.3.37 SkyHook wrapping in `handleSearch`/`handleArtistDiscover`) are untouched.
- New `src/health/providerHealth.js` — circuit breaker. States: `healthy` → `degraded` (1–2 consecutive failures) → `disabled` (3+). Disabled providers are skipped by `safeProviderCall` until the 10-minute cooldown elapses, at which point one canary attempt is allowed; success restores healthy, failure leaves disabled and resets the cooldown clock. State is in-memory only — process restart re-probes from healthy. Logs WARN once on transition to disabled and INFO once on canary restore (no per-failure log spam during sustained outages).
- New `src/health/providerMetrics.js` — per-provider EWMA latency (0.7 history / 0.3 new), success/failure counters, and `lastSuccess` for freshness decay. `computeScore()` returns a 0–1 composite: `successRate*0.5 + latencyScore*0.3 + freshnessScore*0.2`. `latencyScore = 1/(1 + ms/1000)` — chosen over `1/ms` so latency actually contributes to the weighted total (the `1/ms` form gave 0.001-scale values that latency-weighting dropped to noise). `sortByScore(items)` orders any list of `{name}`-bearing items by descending score for parallel fan-out.
- New `src/providers/safeProviderCall.js` — wraps any provider fn with: skip-if-disabled, latency record on every non-skipped path, shape validation, success/failure recording, exception re-throw. Per finalized rules: empty array result is **success** (legitimate "no match"), invalid shape is **failure**, exceptions are **failure**. Item-level shape: each item must carry `artistName`, `albumName`, or `title` — items lacking all three are filtered, and an array where every item is filtered out becomes `INVALID_SHAPE`. Object results (the `aggregateArtist` provider contract) require the same plus an optional `albums` array.
- New `src/shadow/shadowRunner.js` — `shadowCall(name, fn, query)` for fire-and-forget provider exercising. Caller is never awaited or affected; errors are caught and logged at INFO; sync throws inside `fn` are converted via `Promise.resolve()` so they cannot escape. Logs `provider`, `success`, `latencyMs`, and either `length` or `error`.
- New `src/utils/testArtists.js` — rotating artist pool (`Radiohead`, `Kendrick Lamar`, `Daft Punk`, `Miles Davis`, `Taylor Swift`, `Aphex Twin`, `Metallica`, `Bad Bunny`, `Nirvana`, `Hans Zimmer`). `getNextArtist()` returns `pool[Math.floor(Date.now()/86400000) % pool.length]` — deterministic per UTC day, rotates daily across the whole pool. The harness no longer accidentally exercises only one artist's data path day-after-day, which would mask provider-specific failures.
- `src/providers/index.js::aggregateArtist` — every parallel provider call now goes through `safeProviderCall`, and the input list is sorted by `providerMetrics.sortByScore` before fan-out. Existing `metrics.recordProviderCall` calls are preserved (different consumer: dashboard/stats endpoint vs. adaptive sorting). Disabled providers throw a `PROVIDER_DISABLED` sentinel inside the `Promise.allSettled` wrapper so existing partial-failure detection keeps working unchanged.
- `src/providers/artist-discovery.js::tryProvidersInOrder` — every fallback-chain call now goes through `safeProviderCall`. Per finalized rule 6, fallback **order is not reordered** by score — operator-configured priority (`MB → iTunes → TheAudioDB → Discogs`) is preserved. Disabled providers are silently skipped (`null` return → `continue`); shape failures and exceptions still trigger the existing `Discovery provider failed` warning.
- `scripts/site-tests.sh` — section 5b (SkyHook search-shape conformance) now picks today's artist via `node -e "...testArtists.getNextArtist()"`; falls back to `Radiohead` if the source tree isn't reachable. Echoes the chosen artist at the top of the section so the run log self-documents which artist's data path was exercised.
- `scripts/check-mb-recovery.sh` — `LOOKUP_TERM` default rotates through the pool (with same fallback).
- 31 new unit tests across the 5 new modules. Total suite: **370 tests, 0 failures.**
- **Untouched (verified):** `src/utils/skyhook.js`, `src/controllers/proxy.controller.js`, all response-shape logic, retry/rate-limit, caching, snapshots, request correlation, the v0.3.37 SkyHook wrapping behavior.

## v0.3.37 - 2026-05-01

- **Fix Lidarr "Invalid response received from LidarrAPI" on search.** `/api/search` previously returned a flat array of internal candidate objects (`[{artistName, foreignArtistId, type, source, ...}]`). Lidarr's SkyHook deserializer (`SkyHookProxy.SearchForNewEntity`) expects a polymorphic discriminated-union array — every item must be `{"artist": {...}}` or `{"album": {...}}` — and dies before inspecting any field when the wrapper is missing. The proxy now wraps each result accordingly. Independent of the MB connectivity issue: even with MB unreachable, search results from iTunes/TheAudioDB/Discogs now display in Lidarr's add-artist UI (though adding still requires a non-empty `foreignArtistId`, which only MB supplies).
- New module `src/utils/skyhook.js` exporting `toSkyhookSearchShape(candidates)`. Pure shape transformation — no enrichment, no MBID synthesis, no fallback. Each output artist carries the nine keys Lidarr's deserializer requires (`foreignArtistId`, `artistName`, `disambiguation`, `overview`, `type`, `status`, `links`, `images`, `albums`); each album carries `foreignAlbumId`, `title`, `releaseDate`, `images`, and a nested `artist`. Defaults: `type: "Group"`, `status: "active"`, empty arrays for collections. Song candidates from MB recording lookups are dropped (SkyHook search models artists and albums only). MBID falls back from `candidate.foreignArtistId` to `candidate.ids.musicbrainzArtistId` so MB-sourced candidates surface their id even when the controller-layer field is empty.
- Wired into `handleSearch` (all three response paths: cache hit, coalesce-loop cache hit, fresh fetch) and `handleArtistDiscover` (envelope's `candidates` field — envelope shape preserved for the proxy's own UI). Cache stores raw candidates; transformation happens at response time so cached payloads remain re-shapeable.
- New regression tests: 10 `toSkyhookSearchShape` unit tests covering wrap shape, MBID fallback, no-synthesis guarantee for non-MB sources, song filtering, defensive defaults for null/non-object entries, and a contract test asserting every required Lidarr key is present on every output. Three controller tests updated to mock realistic candidate-shape inputs and assert SkyHook-wrapped outputs.
- Removed dead `_generatedAt` property assignment on cached arrays — JS allows it but JSON.stringify never serialized it (only numeric indices on arrays serialize).
- No changes to provider logic, fallback chain, MB behavior, retry/rate-limit, caching strategy, snapshots, or `/api/v0.4/artist/lookup`.

## v0.3.36 - 2026-05-01

- **Stop truncating provider release dates to year-only.** Previously every album's `firstReleaseDate` was built via `String(album.year)`, throwing away full ISO 8601 timestamps from iTunes (`"1997-05-21T07:00:00Z"`) and YYYY-MM-DD precision from MusicBrainz (`"1997-05-21"`). The Lidarr response now emits proper ISO 8601 UTC timestamps, padded when source precision is lower (e.g. TheAudioDB/Discogs year-only `"1997"` → `"1997-01-01T00:00:00Z"`). Surfaced by v0.3.35's verification harness — Lidarr's .NET date parser rejects bare year strings.
- New album field `releaseDate` on every provider's output (iTunes, MusicBrainz, TheAudioDB, Discogs) carrying the source's most precise date string. The existing integer `year` field is unchanged for backwards compatibility with consumers like Melodash.
- `aggregateArtist` propagates `releaseDate` through the album merge. Identity (year, provider tag) goes to the higher-scored provider as before; **`releaseDate` precedence is independent of score** and prefers the more precise source string. So if iTunes (lower score) supplies a full ISO and MusicBrainz (higher score) supplies just a year, the merged album keeps MB's year and iTunes' full date.
- New `src/utils/dates.js` with `toIsoDate(value)`. Centralizes the YYYY → YYYY-MM-DD → ISO timestamp padding logic so the three response builders (`handleArtistLookup`, `verifyCache`, `handleDebugSearch`) stay in sync. Unit-tested for full ISO passthrough, date-only padding, year-month padding, year-only padding, numeric input, and unknown-format passthrough.
- New regression tests: provider tests assert `releaseDate` is emitted; aggregator test asserts precision-wins-over-score for `releaseDate`; controller test asserts an iTunes ISO date flows through `handleArtistLookup` to the response unchanged.
- No behavior change to `foreignArtistId` (still empty when MB is excluded from `metadataProviders` — re-enable MB to populate), retry/rate-limit/caching, or any other route.

## v0.3.35 - 2026-05-01 (hotfix)

- **Stop 502s when MusicBrainz is unreachable.** `/api/search` and `/api/v1/artist/discover` no longer hard-depend on MusicBrainz. `discoverArtists` now reads `metadataProviders` and walks the configured set in fallback order (`musicbrainz → itunes → theaudiodb → discogs`); the first non-empty success wins. When MB is not in the active set, MB is never called. When all enabled providers fail, discovery returns `[]` and the route returns `200` with `partial: true` and a `warning` field — never `502`. Required after the ongoing MB TLS resets started failing every retry.
- **PII / upstream-config sanitization in error bodies.** `handleSearch`'s `502` body previously echoed the entire axios `err.config` to the client — including the upstream URL, query params, and the `User-Agent` header that carries the operator's contact email (`User-Agent: ... (operator@example.com)`). Client-facing `details` is now restricted to `{ message, code }`. `handleArtistDiscover` is similarly tightened (no `err.config`, no `error.response.headers`, no upstream URL). Diagnostics for operators continue to flow into structured WARN logs and the `/debug/upstream` ring buffer; nothing actionable for operators is lost.
- New regression tests: `metadataProviders=itunes,theaudiodb,discogs` config never invokes MusicBrainz; ordered fallback correctly walks MB → iTunes → TheAudioDB → Discogs; all-providers-fail returns `[]` not a thrown error; `502` bodies for `handleSearch` and `handleArtistDiscover` cannot contain `User-Agent`, operator email, upstream URL, headers, or query params (asserted via JSON-stringify substring scan).
- No changes to `/api/v1/artist` (full lookup), `/api/health`, retry policy, rate limiting, caching, or request-correlation ids.

## v0.3.34 - 2026-05-01

- Added per-request correlation IDs via `AsyncLocalStorage`. The same id flows through providers, retries, logs, the tracer, and the `/debug/upstream` ring buffer. Operators can now answer "what happened during *this* request?" with a single id.
- New middleware mounted as the first handler: honors a client-supplied `X-Request-Id` header (validated against `^[A-Za-z0-9_-]{1,64}$` — hex / UUID / base64url alphabets, max 64 chars). Invalid or missing values are replaced with a fresh 8-byte hex id; valid values are passed through unchanged. The id is reflected on every response as `X-Request-Id`.
- Logger auto-injects `requestId` into every log line emitted within an HTTP request scope. No call-site changes — wrapped once in `formatMessage`. Logs emitted outside any request (boot, scheduled jobs, monitor) omit the field.
- The tracer's `createTrace` now consumes the inbound id when set (fallback to UUID), so `requestId == tracerId == ringBufferId == logId == response X-Request-Id` — single source of truth.
- `musicBrainzGet` reads the inbound id first, falling back to its own per-call generated id for direct callers (boot probe, monitor, diagnose endpoint). Across multiple providers + retries within one inbound request, all attempts share the same id.
- `/debug/upstream` accepts a new `?requestId=<id>` filter to pull every attempt across every provider for one request.
- No behavioral change to retries, caching, or rate limiting.

## v0.3.33 - 2026-05-01

- Honor `Retry-After` headers on 429 and 503 responses. Both delta-seconds (`Retry-After: 30`) and HTTP-date (`Retry-After: Wed, 01 May 2026 08:00:00 GMT`) formats are accepted; past dates and malformed values fall back to jittered exponential backoff. The honored value is clamped to `UPSTREAM_RETRY_MAX_MS` (default 30s) to prevent worker threads parking indefinitely. Required by Cloudflare and other CDNs that emit 503 with Retry-After.
- Replaced the previous 500ms/1000ms jitterless retry with **full-jitter exponential backoff** (`wait = random(0, base * 2^(attempt-1))`, capped at the max). Best burst-collapse property of the standard jitter strategies; avoids retry storms when many requests fail simultaneously.
- Three new runtime config keys: `UPSTREAM_MAX_ATTEMPTS` (default 3), `UPSTREAM_RETRY_BASE_MS` (default 500), `UPSTREAM_RETRY_MAX_MS` (default 30000). Exposed via `PATCH /api/settings` and `DELETE /api/settings/runtime/{key}` like all other editable settings.
- `/debug/upstream` ring buffer entries gain two fields: `retryAfterMs` (parsed Retry-After header value, raw — preserved even when clamped) and `nextWaitMs` (the actual sleep duration before the next attempt; null on the final attempt and on success entries). Operators can now see at a glance whether MB is asking us to back off and whether we honored that ask.
- Single-line structured WARN log per retry decision: `provider, path, requestId, attempt, nextAttempt, reason, nextWaitMs, retryAfterMs`. Grep-friendly.
- No change to retry eligibility rules: 5xx + 429 + network errors still retry; 4xx (non-429) still throws immediately. No change to default attempt count.

## v0.3.32 - 2026-05-01

- Added per-attempt upstream observability. Every MusicBrainz HTTP attempt (success or failure) now records a structured entry in an in-memory ring buffer (capped at 100, FIFO eviction). Each entry captures `ts`, `requestId` (shared across the 3 retries of a single call), `provider`, `path`, `attempt#`, `selectedAddress`, `selectedFamily`, `failedStep` (`dns | tcp | tls | http | parse | null`), `error.code`, `httpStatus`, and `durationMs`. ECONNRESET → `tls`, ENOTFOUND/EAI_AGAIN → `dns`, ECONNREFUSED/EHOSTUNREACH → `tcp`, axios timeouts → `http` (phase ambiguous from axios alone — raw `error.code` is preserved for operators).
- New endpoint: `GET /debug/upstream`. Returns `{ entries, filteredCount, totalCount, maxSize }` with newest-first ordering. Supports `?provider=<name>` (case-insensitive filter) and `?limit=<n>` query params. Answers "is this failing every time? same IP? same step? same error?" in one call.
- No retry behavior change. The instrumentation only records — retries, backoff, queue serialization, and timeouts are unchanged. `Retry-After` handling and full request-level correlation are tracked for follow-ups.
- Cleaned up working-tree scratch and unreviewed experimental files that were accidentally swept into a prior bulk commit (`compose.yml`, `bad.yml`, `test-{mock,yaml,compose}*`, `patch-upgrade.scratch.js`, and three unreviewed `src/e2e/*` files). The release is scoped strictly to the observability addition.

## v0.3.31 - 2026-05-01

- Added runtime override reset (Option C from the env-shadowing investigation). The proxy keeps its `saved > env > fallback` precedence — Settings UI edits still win — but operators now have an escape hatch when a previously-saved value is shadowing an env var they've changed.
- New endpoint: `DELETE /api/settings/runtime/{key}` (auth-gated). Removes a saved override so `getConfigValue(key)` falls back to env (or built-in default). Returns `{ ok, key, cleared, newValue, newSource }`.
- `PATCH /api/settings` now accepts `null` as a clear-saved-override sentinel (e.g. `{ "metadataProviders": null }`), and the response includes a `cleared` map alongside `applied` and `skipped`.
- Boot-time warning: at startup, the server logs a structured WARN per saved runtime value that differs from its env var. The log line includes `key`, `envName`, `savedValue`, `envValue`, and a `hint` pointing at the DELETE endpoint and the null-PATCH form.
- Melodash settings page: when `metadataProviders` or `providerPriority` has `source: 'saved'`, the Providers section now shows an amber callout with a "Reset to env defaults" button that PATCHes both keys to `null`. No more manual `data/settings.json` edits to recover from a UI override.
- No breaking changes. Existing PATCH callers that didn't use `null` continue to work; the response just gains an empty `cleared: {}`.

## v0.3.30 - 2026-05-01

- Added `GET /debug/diagnose?provider=musicbrainz`: a one-shot diagnostic that runs DNS resolution → TCP connect → TLS handshake → HTTP GET → JSON parse against the configured MusicBrainz base URL and returns a structured payload showing exactly where the pipeline failed (`failedStep`: `dns | tcp | tls | http | parse`). Surfaces resolved A/AAAA records, the address Node actually selected, the configured `musicbrainzIpFamily`, per-phase timings (`dns/tcp/tls/http/total`), HTTP status, response headers, and any rate-limit headers (`Retry-After`, `X-RateLimit-*`). Uses a fresh `agent: false` connection so handshake times are always measured, and works even when MusicBrainz is disabled in `METADATA_PROVIDERS`. Read-only; does not touch the upstream monitor or rate-limit queue.

## v0.3.29 - 2026-05-01

- Made `/api/ready` provider-aware. The upstream monitor now reads `METADATA_PROVIDERS` and only probes MusicBrainz when it is in the active set. When MB is disabled (e.g. `METADATA_PROVIDERS=itunes,theaudiodb,discogs`), the monitor reports `upstream: "not_applicable"` instead of `unreachable`, and readiness no longer downgrades to `degraded` over an upstream the operator has intentionally turned off.
- Added `probedProvider` and `activeProviders` fields to `/api/ready`'s `upstreamDetail` so consumers can see what was probed and what's enabled.
- MusicBrainz remains fully supported — when it's in `METADATA_PROVIDERS`, the existing probe and structured-error reporting are unchanged.

## v0.3.28 - 2026-05-01

- Fixed Proxmox installer's compose template so fresh installs route MusicBrainz over IPv6 by default. Removed `NODE_OPTIONS: --dns-result-order=ipv4first` (which forced Node to prefer IPv4 globally and caused TLS resets to MusicBrainz on networks where IPv4 fails) and added `MUSICBRAINZ_IP_FAMILY: "6"` so the proxy's https.Agent pins MusicBrainz to IPv6.
- Updated the upgrade script to auto-heal existing installs: after enabling Docker IPv6, it now also strips the `ipv4first` NODE_OPTIONS line and inserts `MUSICBRAINZ_IP_FAMILY: "6"` into the deployed compose. Existing installs flip green on next `upgrade-proxmox-lxc.sh` run.
- Updated the upgrade canary's `docker run` to use `MUSICBRAINZ_IP_FAMILY=6` instead of the IPv4-first NODE_OPTIONS, so canary contract validation passes on networks where only IPv6 reaches MusicBrainz.

## v0.3.27 - 2026-04-30

- Added `scripts/recover-compose.sh`: regenerates a clean `/opt/melodarr-proxy/compose.yml` on a deployed LXC and force-recreates the stack. Backs up the existing compose, validates YAML before applying, then polls `/api/ready` for up to 60s. Use it when manual sed edits or terminal-paste indentation drift have corrupted the deployed compose.
- Added `scripts/test-install.sh`: repeatable end-to-end install validation. Targets a Proxmox LXC via `CTID=...` or any `BASE_URL`. Runs colored PASS/FAIL checks for `/api/health`, `/api/ready`, `/api/version`, redis connectivity, Melodash HTML, LXC IPv6→MusicBrainz, Docker IPv6 enablement, in-container IPv6→MusicBrainz, upstream healthy, and end-to-end `/api/search`. On failure, prints actionable hints (e.g. the `daemon.json` snippet to enable Docker IPv6 when the LXC has IPv6 but the container does not).

## v0.3.26 - 2026-04-30

- Added `scripts/proxy-diag.sh`: command-line diagnostics for a deployed proxy. Subcommands `health`, `ready`, `version`, `mb [4|6|auto]`, `search`, `login`, `stats`, `settings`, `logs`, `set-ip-family`, `compose-cat`, `compose-validate`, `all`. Auto-targets the local LXC, a remote `pct exec $CTID`, or any `BASE_URL`. `set-ip-family` rewrites `MUSICBRAINZ_IP_FAMILY` in the deployed `compose.yml` via a base64-encoded Python helper instead of fragile multi-line sed (sidesteps the YAML corruption seen when running quoted sed through `pct exec bash -c`).
- Added the diagnostics runner as menu option 12 in `manage.sh`.

## v0.3.25 - 2026-04-30

- Made Melodash deployment-agnostic. Added `lib/proxy.ts` with `resolveProxyBaseUrl()` (env override → same-origin in browser → server fallback) and `fetchWithFallback()` that retries against `NEXT_PUBLIC_PROXY_FALLBACK` if the primary base fails. `lib/fetcher.ts` now routes any relative path through the resolver, so existing SWR keys like `/api/health` and `/debug/overview` automatically hit the right base.
- Removed the empty `baseUrl: ""` from `lib/services.ts`. `ServiceCard` and the `service/[name]` page no longer template a base into SWR keys; they just use paths.
- `ServiceCard` now renders a "Proxy unreachable" panel (with the underlying error message and a hint to set `NEXT_PUBLIC_PROXY_BASE_URL` or wire a reverse proxy) instead of staying stuck on "Checking" forever. The card and detail page also surface `version` and `instanceId` from `/api/health`.
- `ControlPanel` no longer takes a `baseUrl` prop; it routes through `fetchWithFallback`.

## v0.3.24 - 2026-04-30

- Added `service` and `version` fields to `/api/health` and `/api/ready` payloads so Melodash and other clients can identify the proxy without reading separate metadata. `service` reads from `APP_NAME` (default `melodarr-proxy`), `version` from `APP_VERSION`.
- Fixed `handleSearch` controller tests and lint that broke after the Lidarr-compatibility rewrite (`ec19ef4`) swapped `upstreamService.search` for `discoverArtists`. Tests now mock `discoverArtists` and assert the new missing-query error wording; the unused `upstreamService` require was removed.

## v0.3.21 - 2026-04-29

- Achieved 94%+ test coverage for proxy.controller by adding comprehensive unit tests with module mocking.
- Added unit tests for external dependencies including Cache, Providers, and Upstream Services.
- Resolved various linting issues caught by `standard` by cleaning up test code unused variables and spacing.
- Enforced `XDG_CACHE_HOME=.cache` for consistent lint caching across environments.

## v0.3.18 - 2026-04-29

- Granted the release workflow `contents: write` so GitHub release creation can generate and publish release notes after validation passes.

## v0.3.17 - 2026-04-29

- Published Melodash as `linux/amd64` in the release workflow to avoid the Next.js dashboard build hanging under ARM emulation. The proxy image remains multi-arch.

## v0.3.16 - 2026-04-29

- Pinned release scanning to `aquasecurity/trivy-action@v0.36.0` and opted GitHub JavaScript actions into Node.js 24 during release validation.

## v0.3.15 - 2026-04-29

- Fixed release canary validation to check public health, OpenAPI, and Scalar docs endpoints instead of calling authenticated artist lookup without an API key.

## v0.3.14 - 2026-04-29

- Removed bundled global npm/npx from final runtime images after dependency installation to avoid scanning unused npm internals.
- Started Melodash directly through Next's Node entrypoint instead of requiring npm at runtime.

## v0.3.13 - 2026-04-29

- Removed build-time lockfiles from the final proxy and Melodash runtime images so vulnerability scans only evaluate runtime dependencies.
- Moved CI and container builds to Node.js 24 LTS.

## v0.3.12 - 2026-04-29

- Renamed the dashboard service and published image to Melodash.
- Updated Compose, Proxmox install/update scripts, docs, and release workflows to use `melodash` and `ghcr.io/melodarr/melodarr-proxy-melodash`.
- Removed development/test tooling from the production proxy image install path so vulnerability scans do not flag non-runtime packages.

## v0.3.11 - 2026-04-29

- Restored the separate dashboard container as a first-class deployed service.
- Added a production dashboard image so the operator UI can be deployed outside the proxy API image.
- Updated Compose and Proxmox install/update flows so standard installs can run `proxy`, `redis`, and the dashboard with the dashboard exposed on port `55026`.

## v0.3.10 - 2026-04-29

- Added packaged dashboard aliases so `/dashboard`, `/settings`, `/stats`, and `/login` serve the bundled operator UI without requiring `.html` paths.
- Added server coverage for the packaged dashboard routes.

## v0.3.9 - 2026-04-29

- Fixed the production Docker image build by removing an invalid Node base-image digest that prevented Buildx from resolving `node:20-bookworm-slim` for both `linux/amd64` and `linux/arm64`.
- Updated runtime version fallbacks and Lidarr setup examples to match the release version.
- Added README commands for pointing plugin-capable Lidarr installs at Melodarr Proxy lookups.

## v0.3.8 - 2026-04-29

- Resolved dashboard routing and enhanced the CI release pipeline with published artifacts.

## v0.3.7 - 2026-04-29

- Reverted v0.3.6. The proxy is API-only — `/api/*`, `/debug/*`, `/docs` (Scalar), `/openapi.json`. The operator dashboard is a separate web app and is not bundled into this image. `GET /` returns API metadata JSON, no static UI is served, and `public/` is no longer mounted.

## v0.3.5 - 2026-04-29

- Fixed proxy crash-looping on container start when the boot upstream probe failed (e.g. transient `ECONNRESET`/TLS resets reaching MusicBrainz). Boot now logs the unhealthy probe and continues; the upstream monitor retries on its own interval and `/api/ready` reflects cached state. Operators can reach Settings to reconfigure (e.g. switch `musicbrainzIpFamily` to `6`) instead of being locked out of the UI by a dying process.

## v0.3.4 - 2026-04-28

- Changed Proxmox installer default `APP_VERSION` from a pinned release tag to `latest`, so fresh installs pull whatever main has most recently published to GHCR. Pinning a specific build is still supported via `APP_VERSION=v0.3.3 ./install-proxmox-lxc.sh`. The `IMAGE` and runtime `APP_VERSION` env both derive from the same variable so they stay aligned with the override.
- Note: GHCR package visibility for `ghcr.io/melodarr/melodarr-proxy` must be set to **Public** under the org's package settings, otherwise unauthenticated pulls will fail with `unauthorized` regardless of which tag is requested.

## v0.3.3 - 2026-04-28

- Fixed Proxmox installer bootstrap failing on Debian 13 (trixie) because `software-properties-common` no longer exists. Trimmed the pre-Docker apt install list to the only packages the script actually uses (`ca-certificates`, `curl`); `gnupg`, `lsb-release`, `apt-transport-https`, and `software-properties-common` were unused.

## v0.3.2 - 2026-04-28

- Fixed Proxmox LXC installer pinning fresh installs to a stale image and runtime version. The image tag and `APP_VERSION` now resolve from a single `APP_VERSION` env var (default `v0.3.2`), keeping installer, container image, and runtime version aligned.

## v0.3.1 - 2026-04-28

- Fixed Proxmox LXC installer to list templates already on the chosen storage and let the operator pick one, falling back to `pveam available` when none are present locally. `TEMPLATE_FILE` env override is preserved for unattended runs; non-TTY runs without an override now exit with a clear error.

## v0.3.0 - 2026-04-29

- Added Scalar API documentation at `/docs` backed by `/openapi.json`.
- Split responsibilities so the proxy exposes API/docs only and Melodash owns the operator UI.
- Added an Updates page in Melodash with release status, changelog display, and a guarded update action.
- Added proxy update status and apply endpoints with GitHub release lookup and runner availability checks.
- Added `manage.sh` options to run proxy lint, proxy tests, Melodash typecheck, and all checks inside containers.
- Added tests for proxy API/docs routing, duplicate static UI removal, and update version comparison.
- Fixed backend lint issues and made background timers non-blocking so the test suite exits cleanly.
- Stabilized provider scoring tests so they are isolated from Compose runtime provider-priority settings.

## v0.2.0 - 2026-04-28

- Redesigned Melodash around Melodarr Proxy with Dashboard, Insights, Analytics, Requests, Explorer, and Settings views.
- Added Explorer search modes for artist, song, album, and artist plus song workflows.
- Added visual Explorer results with artwork cards and a JSON tab for raw debug output.
- Added richer request trace inspection with provider timing, steps, raw details, and copyable logs.
- Added provider testing from Settings, including drag-and-drop provider priority and per-provider diagnostics.
- Added custom provider configuration and a visual mapping builder backed by proxy-side JSONPath transforms.
- Added MusicBrainz API key support and moved MusicBrainz identity/contact into runtime configuration.
- Fixed MusicBrainz TLS resets in Docker by running the proxy on a Debian Node image and routing MusicBrainz over IPv6.
- Restored Melodash Compose support on `MELODASH_HOST_PORT` and added `manage.sh` network setup for local operation.
- Added debug endpoints for artist discovery, song-to-album lookup, provider tests, snapshots, and request tracing.

## v0.1.1 - 2026-04-28

- Added Proxmox LXC installer script and streamlined README usage docs.
- Added Lidarr setup guide and linked it from compatibility documentation.
- Protected `main` with required PR checks.
- Tuned Dependabot to avoid unplanned major Node Docker and Express upgrades.
- Pinned optional service dependencies and added Yarn lockfiles.
- Added immutable Yarn installs for optional service Docker builds.
- Tightened Docker build contexts for root and optional services.
- Added integration coverage for artist lookup cache behavior, response shape, provider failure handling, and API-key middleware.

## v0.1.0 - 2026-04-28

- Added multi-provider metadata support.
- Added provider visibility to lookup responses and stats.
- Added Yarn-based development workflow.
- Added CI for lint, tests, and Docker builds.
- Added Docker health checks and Compose profiles for optional services.
- Added provider checkbox controls on the Settings page.
- Added API and Lidarr compatibility documentation.
- Added Dependabot configuration and Docker build context cleanup.
- Hardened the production container to run as a non-root user.
- Replaced personal SSH deployment with a GHCR image publishing workflow.

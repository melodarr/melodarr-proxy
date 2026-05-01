// Per-provider rolling metrics for adaptive scoring + persistence.
//
// Tracked per provider:
//   - success / failure counters (raw, ever-growing)
//   - EWMA latency (0.7 history, 0.3 new sample)
//   - lastSuccess timestamp (last successful call)
//   - lastUpdated timestamp (last record() call)
//   - lastDecayAt timestamp (anchor for time-based decay reads)
//
// computeScore is consumed by aggregateArtist's sortProviders to prefer
// faster + more reliable providers in the parallel fan-out. The fallback
// chain in artist-discovery does NOT use this score — it preserves the
// operator-configured priority order. (See finalized rule 6.)
//
// v0.3.40 changes (per finalized design):
//   - Persistence to data/providerMetrics.json. Load is async on module
//     init (no blocking I/O). Saves are debounced — at most one write
//     every 30s regardless of call volume, so the hot path does NOT pay
//     a sync I/O cost.
//   - Time-based decay (read-only). computeScore takes a clone, applies
//     elapsed-time decay to that clone, computes the score, and discards
//     the clone. The original `m` is never mutated by computeScore — it
//     remains a pure function with a stable contract for sortByScore.
//   - Decay rationale: a provider with 1000 ancient successes shouldn't
//     dominate over one with 5 recent successes. Note that uniform decay
//     of both counters preserves successRate (this is documented in the
//     test suite); the practical effect is on raw count display via
//     /debug/providers/metrics, not on the score itself.

const fs = require('fs/promises')
const path = require('path')

const metrics = new Map()
const FRESHNESS_HORIZON_MS = 10 * 60 * 1000

// Path is overridable via env so tests can use temp files without
// stomping on a real persistence file.
const DATA_PATH = process.env.PROVIDER_METRICS_PATH || path.join(process.cwd(), 'data', 'providerMetrics.json')

// Debounce window — at most one fs.writeFile per this many ms even
// under sustained call volume. 30s is short enough to not lose much on
// process kill, long enough to amortise across hundreds of req/min.
const SAVE_DEBOUNCE_MS = parseInt(process.env.PROVIDER_METRICS_SAVE_MS || '30000', 10)
let saveTimer = null

function get (name) {
  if (!metrics.has(name)) {
    const now = Date.now()
    metrics.set(name, {
      success: 0,
      failure: 0,
      avgLatency: 0,
      lastSuccess: null,
      lastUpdated: now,
      // Anchor for decay calculations. Set at creation so the first
      // computeScore call has a meaningful "elapsed since" reference.
      lastDecayAt: now
    })
  }
  return metrics.get(name)
}

function record (name, success, latency) {
  const m = get(name)
  if (success) {
    m.success++
    m.lastSuccess = Date.now()
  } else {
    m.failure++
  }
  m.avgLatency = m.avgLatency === 0
    ? latency
    : (m.avgLatency * 0.7 + latency * 0.3)
  m.lastUpdated = Date.now()
  scheduleSave()
}

// Read-only decay. Mutates the *clone* passed in, never the real metric
// object. Decay factor: 0.98 per minute of elapsed time since
// lastDecayAt. Applied to both success and failure equally — preserves
// successRate but reduces the absolute counts visible in the metrics
// debug endpoint.
function applyDecay (clone) {
  const now = Date.now()
  const last = clone.lastDecayAt || now
  const minutes = (now - last) / 60000
  if (minutes > 0) {
    const factor = Math.pow(0.98, minutes)
    clone.success *= factor
    clone.failure *= factor
    clone.lastDecayAt = now // only on the clone — original m unchanged
  }
}

// Returns a 0–1 composite score. Higher is better. PURE — no side
// effects on the input. Two signals (v0.3.40 simplified weighting):
//   - successRate (0.5): fraction of decayed calls that succeeded
//   - latencyScore (0.5): 1/(1 + ms/1000); a fresh provider with no
//     samples (avgLatency=0) gets the legacy default of 1000ms = 0.5
function computeScore (m) {
  if (!m) return 0
  const clone = { ...m }
  applyDecay(clone)
  const total = (clone.success + clone.failure) || 1
  const successRate = clone.success / total
  const latencyScore = 1 / (1 + (clone.avgLatency || 1000) / 1000)
  return successRate * 0.5 + latencyScore * 0.5
}

function reset () {
  metrics.clear()
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

function sortByScore (items) {
  return items
    .map((item) => ({ item, score: computeScore(get(item.name)) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}

function _getAllNames () {
  return Array.from(metrics.keys())
}

// Async load on module init. Failures (missing file, parse error, perms)
// are silent — the in-memory map just stays empty and we proceed with
// fresh state. Logging an error here would noise up startup; the
// /debug/providers/health endpoint will reflect actual state regardless.
async function load () {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v === 'object') metrics.set(k, v)
    }
  } catch {
    // missing/corrupted file — accept fresh state
  }
}

// Debounced async write. Coalesces all record() calls within the
// SAVE_DEBOUNCE_MS window into one fs.writeFile. The hot path returns
// immediately; the actual disk write happens off-stack on the timer.
function scheduleSave () {
  if (saveTimer) return
  saveTimer = setTimeout(async () => {
    saveTimer = null
    try {
      await fs.mkdir(path.dirname(DATA_PATH), { recursive: true })
      await fs.writeFile(
        DATA_PATH,
        JSON.stringify(Object.fromEntries(metrics), null, 2)
      )
    } catch {
      // ignore write failures — next call re-arms the timer
    }
  }, SAVE_DEBOUNCE_MS)
  // Don't keep the event loop alive just for this timer.
  if (saveTimer.unref) saveTimer.unref()
}

// Fire-and-forget initial load. Tests that need deterministic state
// should call reset() then load() (or set PROVIDER_METRICS_PATH to a
// controlled file) rather than relying on this race.
load().catch(() => {})

module.exports = {
  get,
  record,
  computeScore,
  sortByScore,
  reset,
  _getAllNames,
  load,
  applyDecay,
  scheduleSave,
  DATA_PATH,
  SAVE_DEBOUNCE_MS,
  FRESHNESS_HORIZON_MS
}

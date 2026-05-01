// Per-provider rolling metrics for adaptive scoring.
//
// Tracked per provider:
//   - success / failure counters (since process start)
//   - EWMA latency (0.7 history, 0.3 new sample)
//   - lastSuccess timestamp (for freshness decay)
//
// computeScore is consumed by aggregateArtist's sortProviders to prefer
// faster + more reliable providers in the parallel fan-out. The fallback
// chain in artist-discovery does NOT use this score — it preserves the
// operator-configured priority order. (See finalized rule 6.)

const metrics = new Map()

const FRESHNESS_HORIZON_MS = 10 * 60 * 1000

function get (name) {
  if (!metrics.has(name)) {
    metrics.set(name, {
      success: 0,
      failure: 0,
      avgLatency: 0,
      lastSuccess: null
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
  // First sample seeds the EWMA verbatim; subsequent samples blend.
  m.avgLatency = m.avgLatency === 0
    ? latency
    : (m.avgLatency * 0.7 + latency * 0.3)
}

// Returns a 0–1 composite score. Higher is better. Three signals:
//   - successRate (0.5): fraction of all calls that succeeded
//   - latencyScore (0.3): 1/(1 + ms/1000); 100ms ≈ 0.91, 1s ≈ 0.5, 10s ≈ 0.09
//   - freshnessScore (0.2): linear decay over the freshness horizon (10 min)
//
// The latency formula is the finalized choice (rule 1) — earlier 1/ms
// version produced 0.001-scale values that effectively weighted latency
// at zero against the other 0–1 signals.
function computeScore (m) {
  if (!m) return 0
  const total = (m.success + m.failure) || 1
  const successRate = m.success / total
  const latencyScore = 1 / (1 + (m.avgLatency || 0) / 1000)
  const freshnessScore = m.lastSuccess
    ? Math.max(0, 1 - (Date.now() - m.lastSuccess) / FRESHNESS_HORIZON_MS)
    : 0
  return successRate * 0.5 + latencyScore * 0.3 + freshnessScore * 0.2
}

function reset () {
  metrics.clear()
}

// Stable-sort a list of provider-bearing items (each must have a `.name`)
// by descending score. Used by aggregateArtist's parallel fan-out per
// finalized rule 6 — the fallback chain in artist-discovery does NOT
// call this, so operator-configured priority order is preserved there.
function sortByScore (items) {
  return items
    .map((item) => ({ item, score: computeScore(get(item.name)) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}

module.exports = { get, record, computeScore, sortByScore, reset, FRESHNESS_HORIZON_MS }

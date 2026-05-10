const { test, after } = require('node:test')
const assert = require('node:assert/strict')

function freshMetrics () {
  const metricsPath = require.resolve('./index')
  delete require.cache[metricsPath]
  return require('./index')
}

// ── recordRequest ─────────────────────────────────────────────────

test('recordRequest increments total request count', () => {
  const m = freshMetrics()
  m.recordRequest()
  m.recordRequest()
  assert.equal(m.stats.requests.total, 2)
  m.shutdown()
})

test('recordRequest maintains the sliding RPM window', async () => {
  const m = freshMetrics()
  m.recordRequest()
  m.recordRequest()
  // Both timestamps are within the last minute
  assert.equal(m.getRPM(), 2)
  m.shutdown()
})

// ── recordCache ───────────────────────────────────────────────────

test('recordCache increments hits on cache hit', () => {
  const m = freshMetrics()
  m.recordCache(true)
  m.recordCache(true)
  assert.equal(m.stats.cache.hits, 2)
  assert.equal(m.stats.cache.misses, 0)
  m.shutdown()
})

test('recordCache increments misses on cache miss', () => {
  const m = freshMetrics()
  m.recordCache(false)
  assert.equal(m.stats.cache.hits, 0)
  assert.equal(m.stats.cache.misses, 1)
  m.shutdown()
})

test('recordCache tracks stale cache hits', () => {
  const m = freshMetrics()
  m.recordCache(true, true)
  const stats = m.getStats()
  assert.equal(m.stats.cache.staleHits, 1)
  assert.equal(stats.cache.staleHits, 1)
  m.shutdown()
})

// ── lock/provider/Lidarr safety metrics ──────────────────────────

test('recordLockWait tracks wait count, average, and max', () => {
  const m = freshMetrics()
  m.recordLockWait(25)
  m.recordLockWait(75)
  const stats = m.getStats()
  assert.equal(stats.locks.waitEvents, 2)
  assert.equal(stats.locks.avgWaitMs, 50)
  assert.equal(stats.locks.maxWaitMs, 75)
  m.shutdown()
})

test('recordProviderFallback tracks fallback and exhaustion counters', () => {
  const m = freshMetrics()
  m.recordProviderFallback(false)
  m.recordProviderFallback(true)
  const stats = m.getStats()
  assert.equal(stats.providerFallbacks.fallbacks, 1)
  assert.equal(stats.providerFallbacks.exhaustions, 1)
  m.shutdown()
})

test('recordLidarrAddShapeFailure tracks add-shape failures', () => {
  const m = freshMetrics()
  m.recordLidarrAddShapeFailure()
  const stats = m.getStats()
  assert.equal(stats.lidarr.addShapeFailures, 1)
  m.shutdown()
})

// ── recordLatency / getLatencyStats ──────────────────────────────

test('getLatencyStats returns zeros when no samples exist', () => {
  const m = freshMetrics()
  const stats = m.getLatencyStats()
  assert.equal(stats.avgMs, 0)
  assert.equal(stats.p95Ms, 0)
  m.shutdown()
})

test('getLatencyStats computes average correctly', () => {
  const m = freshMetrics()
  m.recordLatency(100)
  m.recordLatency(200)
  m.recordLatency(300)
  assert.equal(m.getLatencyStats().avgMs, 200)
  m.shutdown()
})

test('getLatencyStats caps sample buffer at maxLatencySamples', () => {
  const m = freshMetrics()
  for (let i = 0; i < 1100; i++) {
    m.recordLatency(i)
  }
  assert.equal(m.latencySamples.length, 1000)
  m.shutdown()
})

// ── recordRanking ─────────────────────────────────────────────────

test('recordRanking increments totalRankings', () => {
  const m = freshMetrics()
  m.recordRanking(50, [0.9, 0.6, 0.3], 0.9)
  assert.equal(m.stats.ranking.totalRankings, 1)
  m.shutdown()
})

test('recordRanking classifies scores into distribution buckets', () => {
  const m = freshMetrics()
  m.recordRanking(10, [0.9, 0.7, 0.2], 0.9)
  assert.equal(m.stats.ranking.scoreDistribution.excellent, 1) // >= 0.8
  assert.equal(m.stats.ranking.scoreDistribution.good, 1) // >= 0.5
  assert.equal(m.stats.ranking.scoreDistribution.poor, 1) // < 0.5
  m.shutdown()
})

test('recordRanking accumulates totalRankingTimeMs', () => {
  const m = freshMetrics()
  m.recordRanking(30, [], 0)
  m.recordRanking(70, [], 0)
  assert.equal(m.stats.ranking.totalRankingTimeMs, 100)
  m.shutdown()
})

// ── recordEnrichment ──────────────────────────────────────────────

test('recordEnrichment increments total and successful counts', () => {
  const m = freshMetrics()
  m.recordEnrichment({ success: true, cached: false, latencyMs: 50, hasTags: true, hasPopularity: false })
  assert.equal(m.stats.enrichment.total, 1)
  assert.equal(m.stats.enrichment.successful, 1)
  assert.equal(m.stats.enrichment.coverage.tags, 1)
  assert.equal(m.stats.enrichment.coverage.popularity, 0)
  m.shutdown()
})

test('recordEnrichment tracks cached enrichments separately', () => {
  const m = freshMetrics()
  m.recordEnrichment({ success: true, cached: true, latencyMs: 5, hasTags: false, hasPopularity: true })
  assert.equal(m.stats.enrichment.cached, 1)
  assert.equal(m.stats.enrichment.coverage.popularity, 1)
  m.shutdown()
})

// ── recordApiRequest ──────────────────────────────────────────────

test('recordApiRequest initialises key stats on first call', () => {
  const m = freshMetrics()
  m.recordApiRequest('key-1:App', true, 120)
  const ks = m.stats.apikeys['key-1:App']
  assert.equal(ks.requests, 1)
  assert.equal(ks.errors, 0)
  assert.equal(ks.latencySum, 120)
  m.shutdown()
})

test('recordApiRequest increments errors on failure', () => {
  const m = freshMetrics()
  m.recordApiRequest('key-2:App', false, 50)
  assert.equal(m.stats.apikeys['key-2:App'].errors, 1)
  m.shutdown()
})

// ── recordApiKeyError ─────────────────────────────────────────────

test('recordApiKeyError increments both requests and errors', () => {
  const m = freshMetrics()
  m.recordApiKeyError('masked-key')
  const ks = m.stats.apikeys['masked-key']
  assert.equal(ks.requests, 1)
  assert.equal(ks.errors, 1)
  m.shutdown()
})

// ── getTopQueries ─────────────────────────────────────────────────

test('getTopQueries returns queries sorted by count descending', () => {
  const m = freshMetrics()
  m.recordArtistLookup({ term: 'b', upstreamCalls: 1, providers: [], partial: false })
  m.recordArtistLookup({ term: 'a', upstreamCalls: 1, providers: [], partial: false })
  m.recordArtistLookup({ term: 'a', upstreamCalls: 1, providers: [], partial: false })
  const top = m.getTopQueries(5)
  assert.equal(top[0].query, 'a')
  assert.equal(top[0].count, 2)
  assert.equal(top[1].query, 'b')
  m.shutdown()
})

test('getTopQueries respects the limit parameter', () => {
  const m = freshMetrics()
  for (let i = 0; i < 10; i++) {
    m.recordArtistLookup({ term: `q${i}`, upstreamCalls: 1, providers: [], partial: false })
  }
  assert.equal(m.getTopQueries(3).length, 3)
  m.shutdown()
})

// ── recordArtistLookup ────────────────────────────────────────────

test('recordArtistLookup increments partial count', () => {
  const m = freshMetrics()
  m.recordArtistLookup({ term: 'x', upstreamCalls: 0, providers: [], partial: true, statusCode: 502 })
  assert.equal(m.stats.artistLookup.partialResponses, 1)
  m.shutdown()
})

test('recordArtistLookup increments errors when statusCode >= 400', () => {
  const m = freshMetrics()
  m.recordArtistLookup({ term: 'x', upstreamCalls: 0, providers: [], partial: false, statusCode: 502 })
  assert.equal(m.stats.errors.count, 1)
  m.shutdown()
})

// ── getStats ──────────────────────────────────────────────────────

test('getStats returns a structured snapshot', () => {
  const m = freshMetrics()
  m.recordRequest()
  m.recordCache(true)
  m.recordLatency(100)

  const s = m.getStats()

  assert.ok(typeof s.startedAt === 'string')
  assert.ok(typeof s.uptimeSeconds === 'number')
  assert.equal(s.requests.total, 1)
  assert.equal(s.cache.hits, 1)
  assert.equal(s.cache.hitRate, 1)
  assert.ok(typeof s.latency.avgMs === 'number')
  m.shutdown()
})

test('getStats cache hitRate is null when no requests', () => {
  const m = freshMetrics()
  assert.equal(m.getStats().cache.hitRate, null)
  m.shutdown()
})

test('getStats computes error rate correctly', () => {
  const m = freshMetrics()
  m.recordRequest()
  m.recordRequest()
  m.recordError()
  const s = m.getStats()
  assert.equal(s.errors.rate, 0.5)
  m.shutdown()
})

// ── startProxy / stopProxy ────────────────────────────────────────

test('startProxy sets isRunning to true', () => {
  const m = freshMetrics()
  m.stopProxy()
  m.startProxy()
  assert.equal(m.state.isRunning, true)
  m.shutdown()
})

test('stopProxy sets isRunning to false', () => {
  const m = freshMetrics()
  m.stopProxy()
  assert.equal(m.state.isRunning, false)
  m.shutdown()
})

// ── takeSnapshot / getHistory ─────────────────────────────────────

test('takeSnapshot adds an entry to history', () => {
  const m = freshMetrics()
  m.takeSnapshot()
  const history = m.getHistory()
  assert.equal(history.length, 1)
  assert.ok(typeof history[0].timestamp === 'string')
  assert.ok(typeof history[0].requestsPerMinute === 'number')
  m.shutdown()
})

test('getHistory keeps at most 10 snapshots', () => {
  const m = freshMetrics()
  for (let i = 0; i < 15; i++) {
    m.takeSnapshot()
  }
  assert.equal(m.getHistory().length, 10)
  m.shutdown()
})

// ── recordProviderCall ────────────────────────────────────────────

test('recordProviderCall tracks provider call stats', () => {
  const m = freshMetrics()
  m.recordProviderCall('musicbrainz', true, 200)
  m.recordProviderCall('musicbrainz', false, 500)
  m.recordProviderCall('musicbrainz', false, 300, true)
  const stats = m.providerStats.get('musicbrainz')
  const providerStats = m.getStats().providers.musicbrainz
  assert.equal(stats.calls, 3)
  assert.equal(stats.errors, 2)
  assert.equal(stats.timeouts, 1)
  assert.equal(stats.totalLatency, 1000)
  assert.equal(providerStats.timeouts, 1)
  assert.equal(providerStats.successRate, 0.3333)
  m.shutdown()
})

after(() => {
  const metricsPath = require.resolve('./index')
  delete require.cache[metricsPath]
})

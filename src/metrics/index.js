const { EventEmitter } = require('events')

class MetricsManager extends EventEmitter {
  constructor () {
    super()
    this.state = {
      isRunning: true, // proxy state
      startTime: Date.now(),
      lastQueryAt: null
    }

    this.stats = {
      requests: { total: 0 },
      cache: { hits: 0, misses: 0, staleHits: 0 },
      errors: { count: 0 },
      locks: { waitEvents: 0, totalWaitMs: 0, maxWaitMs: 0 },
      lidarr: { addShapeFailures: 0 },
      artistLookup: {
        total: 0,
        upstreamCalls: 0,
        partialResponses: 0,
        lastLookup: null
      },
      ranking: {
        totalRankings: 0,
        totalRankingTimeMs: 0,
        scoreDistribution: {
          excellent: 0,
          good: 0,
          poor: 0
        },
        sumTopConfidence: 0
      },
      enrichment: {
        total: 0,
        successful: 0,
        cached: 0,
        totalLatencyMs: 0,
        coverage: {
          tags: 0,
          popularity: 0
        }
      },
      apikeys: {
        // key -> { requests, errors, latencySum }
      },
      providers: {
        fallbacks: 0,
        exhaustions: 0
      }
    }

    // Sliding window for RPM
    this.requestTimestamps = []
    this.queryCounts = new Map()

    // Latency samples (last 1000)
    this.latencySamples = []
    this.maxLatencySamples = 1000

    // Provider specific metrics
    this.providerStats = new Map()

    // History snapshots
    this.snapshots = []
    this.snapshotInterval = setInterval(() => this.takeSnapshot(), 60000) // 1 minute interval
    if (this.snapshotInterval.unref) this.snapshotInterval.unref()
  }

  recordRequest () {
    this.stats.requests.total++

    const now = Date.now()
    this.requestTimestamps.push(now)

    const oneMinuteAgo = now - 60 * 1000
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0] < oneMinuteAgo) {
      this.requestTimestamps.shift()
    }

    this.emit('request')
  }

  recordQuery (query) {
    this.recordRequest()
    this.state.lastQueryAt = new Date().toISOString()

    const count = this.queryCounts.get(query) || 0
    this.queryCounts.set(query, count + 1)
  }

  recordArtistLookup ({ term, upstreamCalls = 0, providers = [], partial = false, statusCode = 200, error = null }) {
    this.stats.artistLookup.total++
    this.stats.artistLookup.upstreamCalls += upstreamCalls

    if (partial) {
      this.stats.artistLookup.partialResponses++
    }

    if (statusCode >= 400) {
      this.recordError()
    }

    this.state.lastQueryAt = new Date().toISOString()
    this.stats.artistLookup.lastLookup = {
      term,
      upstreamCalls,
      providers,
      partial,
      statusCode,
      error,
      at: this.state.lastQueryAt
    }

    const count = this.queryCounts.get(term) || 0
    this.queryCounts.set(term, count + 1)
  }

  getTopQueries (limit = 5) {
    const sorted = [...this.queryCounts.entries()].sort((a, b) => b[1] - a[1])
    return sorted.slice(0, limit).map(([query, count]) => ({ query, count }))
  }

  getQueryCount (query) {
    return this.queryCounts.get(query) || 0
  }

  recordError () {
    this.stats.errors.count++
    this.emit('request_error')
  }

  recordCache (hit, isStale = false) {
    if (hit) {
      this.stats.cache.hits++
      if (isStale) this.stats.cache.staleHits++
    } else {
      this.stats.cache.misses++
    }
    this.emit('cache', hit)
  }

  recordLockWait (ms) {
    this.stats.locks.waitEvents++
    this.stats.locks.totalWaitMs += ms
    if (ms > this.stats.locks.maxWaitMs) {
      this.stats.locks.maxWaitMs = ms
    }
  }

  recordProviderFallback (exhausted = false) {
    if (exhausted) {
      this.stats.providers.exhaustions++
    } else {
      this.stats.providers.fallbacks++
    }
  }

  recordLidarrAddShapeFailure () {
    this.stats.lidarr.addShapeFailures++
  }

  recordLatency (ms) {
    this.latencySamples.push(ms)
    if (this.latencySamples.length > this.maxLatencySamples) {
      this.latencySamples.shift()
    }
  }

  recordRanking (rankingTimeMs, scores, topConfidence) {
    this.stats.ranking.totalRankings++
    this.stats.ranking.totalRankingTimeMs += rankingTimeMs
    this.stats.ranking.sumTopConfidence += topConfidence

    for (const score of scores) {
      if (score >= 0.8) this.stats.ranking.scoreDistribution.excellent++
      else if (score >= 0.5) this.stats.ranking.scoreDistribution.good++
      else this.stats.ranking.scoreDistribution.poor++
    }
  }

  recordEnrichment ({ success, cached, latencyMs, hasTags, hasPopularity }) {
    this.stats.enrichment.total++
    this.stats.enrichment.totalLatencyMs += latencyMs

    if (success) this.stats.enrichment.successful++
    if (cached) this.stats.enrichment.cached++

    if (hasTags) this.stats.enrichment.coverage.tags++
    if (hasPopularity) this.stats.enrichment.coverage.popularity++
  }

  recordApiRequest (key, success, latencyMs) {
    if (!this.stats.apikeys[key]) {
      this.stats.apikeys[key] = { requests: 0, errors: 0, latencySum: 0 }
    }
    const ks = this.stats.apikeys[key]
    ks.requests++
    ks.latencySum += latencyMs
    if (!success) {
      ks.errors++
    }
  }

  recordApiKeyError (key) {
    if (!this.stats.apikeys[key]) {
      this.stats.apikeys[key] = { requests: 0, errors: 0, latencySum: 0 }
    }
    this.stats.apikeys[key].requests++
    this.stats.apikeys[key].errors++
  }

  getRPM () {
    const oneMinuteAgo = Date.now() - 60 * 1000
    return this.requestTimestamps.filter(t => t >= oneMinuteAgo).length
  }

  getLatencyStats () {
    if (this.latencySamples.length === 0) return { avgMs: 0, p95Ms: 0 }

    const sum = this.latencySamples.reduce((a, b) => a + b, 0)
    const avg = Math.round(sum / this.latencySamples.length)

    const sorted = [...this.latencySamples].sort((a, b) => a - b)
    const p95Index = Math.floor(sorted.length * 0.95)
    const p95 = sorted[p95Index] || 0

    return { avgMs: avg, p95Ms: p95 }
  }

  recordProviderCall (providerName, success, latencyMs) {
    if (!this.providerStats.has(providerName)) {
      this.providerStats.set(providerName, { calls: 0, errors: 0, totalLatency: 0 })
    }
    const stats = this.providerStats.get(providerName)
    stats.calls++
    if (!success) {
      stats.errors++
    }
    stats.totalLatency += latencyMs
  }

  getStats () {
    const latency = this.getLatencyStats()
    // Error rate is percentage of errors over total requests
    const errorRate = this.stats.requests.total > 0
      ? Number((this.stats.errors.count / this.stats.requests.total).toFixed(4))
      : 0

    const providers = {}
    for (const [name, pStats] of this.providerStats.entries()) {
      providers[name] = {
        calls: pStats.calls,
        errors: pStats.errors,
        avgLatencyMs: pStats.calls > 0 ? Math.round(pStats.totalLatency / pStats.calls) : 0,
        errorRate: pStats.calls > 0 ? Number((pStats.errors / pStats.calls).toFixed(4)) : 0
      }
    }

    const apikeysFormatted = {}
    for (const [key, stats] of Object.entries(this.stats.apikeys)) {
      apikeysFormatted[key] = {
        requests: stats.requests,
        errors: stats.errors,
        errorRate: stats.requests > 0 ? Number((stats.errors / stats.requests).toFixed(4)) : 0,
        avgLatencyMs: stats.requests > 0 ? Math.round(stats.latencySum / stats.requests) : 0
      }
    }

    return {
      startedAt: new Date(this.state.startTime).toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.state.startTime) / 1000),
      state: {
        isRunning: this.state.isRunning,
        lastQueryAt: this.state.lastQueryAt
      },
      requests: {
        total: this.stats.requests.total,
        perMinute: this.getRPM()
      },
      cache: {
        hits: this.stats.cache.hits,
        misses: this.stats.cache.misses,
        staleHits: this.stats.cache.staleHits,
        hitRate: (this.stats.cache.hits + this.stats.cache.misses) > 0
          ? Number((this.stats.cache.hits / (this.stats.cache.hits + this.stats.cache.misses)).toFixed(4))
          : null
      },
      artistLookup: {
        ...this.stats.artistLookup,
        cacheHits: this.stats.cache.hits,
        cacheMisses: this.stats.cache.misses,
        cacheHitRate: (this.stats.cache.hits + this.stats.cache.misses) > 0
          ? Number((this.stats.cache.hits / (this.stats.cache.hits + this.stats.cache.misses)).toFixed(4))
          : null
      },
      latency: {
        avgMs: latency.avgMs,
        p95Ms: latency.p95Ms
      },
      errors: {
        count: this.stats.errors.count,
        rate: errorRate
      },
      locks: {
        waitEvents: this.stats.locks.waitEvents,
        avgWaitMs: this.stats.locks.waitEvents > 0
          ? Math.round(this.stats.locks.totalWaitMs / this.stats.locks.waitEvents)
          : 0,
        maxWaitMs: this.stats.locks.maxWaitMs
      },
      lidarr: {
        addShapeFailures: this.stats.lidarr.addShapeFailures
      },
      providerFallbacks: {
        fallbacks: this.stats.providers.fallbacks,
        exhaustions: this.stats.providers.exhaustions
      },
      providers,
      topQueries: this.getTopQueries(),
      ranking: {
        avgRankingTimeMs: this.stats.ranking.totalRankings > 0
          ? Number((this.stats.ranking.totalRankingTimeMs / this.stats.ranking.totalRankings).toFixed(2))
          : 0,
        scoreDistribution: this.stats.ranking.scoreDistribution,
        avgTopConfidence: this.stats.ranking.totalRankings > 0
          ? Number((this.stats.ranking.sumTopConfidence / this.stats.ranking.totalRankings).toFixed(4))
          : 0
      },
      enrichment: {
        total: this.stats.enrichment.total,
        successRate: this.stats.enrichment.total > 0
          ? Number((this.stats.enrichment.successful / this.stats.enrichment.total).toFixed(4))
          : 0,
        cacheHitRate: this.stats.enrichment.total > 0
          ? Number((this.stats.enrichment.cached / this.stats.enrichment.total).toFixed(4))
          : 0,
        avgLatencyMs: this.stats.enrichment.total > 0
          ? Math.round(this.stats.enrichment.totalLatencyMs / this.stats.enrichment.total)
          : 0,
        coverageRates: {
          tags: this.stats.enrichment.total > 0
            ? Number((this.stats.enrichment.coverage.tags / this.stats.enrichment.total).toFixed(4))
            : 0,
          popularity: this.stats.enrichment.total > 0
            ? Number((this.stats.enrichment.coverage.popularity / this.stats.enrichment.total).toFixed(4))
            : 0
        }
      },
      apikeys: apikeysFormatted
    }
  }

  startProxy () {
    this.state.isRunning = true
  }

  stopProxy () {
    this.state.isRunning = false
  }

  takeSnapshot () {
    const stats = this.getStats()
    const snapshot = {
      timestamp: new Date().toISOString(),
      requestsPerMinute: stats.requests.perMinute,
      latencyAvgMs: stats.latency.avgMs,
      errorRate: stats.errors.rate
    }

    this.snapshots.push(snapshot)
    if (this.snapshots.length > 10) {
      this.snapshots.shift()
    }
  }

  getHistory () {
    return this.snapshots
  }

  shutdown () {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval)
      this.snapshotInterval = null
    }
    this.removeAllListeners()
  }
}

module.exports = new MetricsManager()

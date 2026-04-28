const { EventEmitter } = require('events');

class MetricsManager extends EventEmitter {
  constructor() {
    super();
    this.state = {
      isRunning: true, // proxy state
      startTime: Date.now(),
      lastQueryAt: null
    };

    this.stats = {
      requests: { total: 0 },
      cache: { hits: 0, misses: 0 },
      errors: { count: 0 },
      artistLookup: {
        total: 0,
        upstreamCalls: 0,
        partialResponses: 0,
        lastLookup: null
      }
    };

    // Sliding window for RPM
    this.requestTimestamps = [];
    this.queryCounts = new Map();
    
    // Latency samples (last 1000)
    this.latencySamples = [];
    this.maxLatencySamples = 1000;
    
    // History snapshots
    this.snapshots = [];
    setInterval(() => this.takeSnapshot(), 60000); // 1 minute interval
  }

  recordRequest() {
    this.stats.requests.total++;

    const now = Date.now();
    this.requestTimestamps.push(now);

    const oneMinuteAgo = now - 60 * 1000;
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0] < oneMinuteAgo) {
      this.requestTimestamps.shift();
    }

    this.emit('request');
  }

  recordQuery(query) {
    this.recordRequest();
    this.state.lastQueryAt = new Date().toISOString();
    
    let count = this.queryCounts.get(query) || 0;
    this.queryCounts.set(query, count + 1);
  }

  recordArtistLookup({ term, upstreamCalls = 0, partial = false, statusCode = 200, error = null }) {
    this.stats.artistLookup.total++;
    this.stats.artistLookup.upstreamCalls += upstreamCalls;

    if (partial) {
      this.stats.artistLookup.partialResponses++;
    }

    if (statusCode >= 400) {
      this.recordError();
    }

    this.state.lastQueryAt = new Date().toISOString();
    this.stats.artistLookup.lastLookup = {
      term,
      upstreamCalls,
      partial,
      statusCode,
      error,
      at: this.state.lastQueryAt
    };

    let count = this.queryCounts.get(term) || 0;
    this.queryCounts.set(term, count + 1);
  }

  getTopQueries(limit = 5) {
    const sorted = [...this.queryCounts.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, limit).map(([query, count]) => ({ query, count }));
  }

  getQueryCount(query) {
    return this.queryCounts.get(query) || 0;
  }

  recordError() {
    this.stats.errors.count++;
    this.emit('request_error');
  }

  recordCache(hit) {
    if (hit) {
      this.stats.cache.hits++;
    } else {
      this.stats.cache.misses++;
    }
    this.emit('cache', hit);
  }

  recordLatency(ms) {
    this.latencySamples.push(ms);
    if (this.latencySamples.length > this.maxLatencySamples) {
      this.latencySamples.shift();
    }
  }

  getRPM() {
    const oneMinuteAgo = Date.now() - 60 * 1000;
    return this.requestTimestamps.filter(t => t >= oneMinuteAgo).length;
  }

  getLatencyStats() {
    if (this.latencySamples.length === 0) return { avgMs: 0, p95Ms: 0 };
    
    const sum = this.latencySamples.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / this.latencySamples.length);
    
    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95 = sorted[p95Index] || 0;

    return { avgMs: avg, p95Ms: p95 };
  }

  getStats() {
    const latency = this.getLatencyStats();
    // Error rate is percentage of errors over total requests
    const errorRate = this.stats.requests.total > 0 
      ? Number((this.stats.errors.count / this.stats.requests.total).toFixed(4)) 
      : 0;

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
      topQueries: this.getTopQueries()
    };
  }

  startProxy() {
    this.state.isRunning = true;
  }

  stopProxy() {
    this.state.isRunning = false;
  }

  takeSnapshot() {
    const stats = this.getStats();
    const snapshot = {
      timestamp: new Date().toISOString(),
      requestsPerMinute: stats.requests.perMinute,
      latencyAvgMs: stats.latency.avgMs,
      errorRate: stats.errors.rate
    };
    
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 10) {
      this.snapshots.shift();
    }
  }

  getHistory() {
    return this.snapshots;
  }
}

module.exports = new MetricsManager();

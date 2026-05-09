const cache = require('./cache')
const tracer = require('./tracer')
const upstreamMonitor = require('./monitors/upstream.monitor')
const networkDiagnostics = require('./infrastructure/network/network-diagnostics.service')

const ALERTS_KEY = 'system_alerts'
const PERFORMANCE_VIEW_KEY = 'query_performance_view'

// Run every minute
const JOB_INTERVAL_MS = 60000
const NETWORK_DIAGNOSTICS_INTERVAL_MS = networkDiagnostics.DEFAULT_REFRESH_INTERVAL_MS

async function updateMaterializedViews () {
  if (!cache.isRedisHealthy || !cache.redis) return

  try {
    const traces = await tracer.getTraces(1000) // Analyze up to last 1000 for the view

    const queryLatencies = {}
    const providerLatencies = {}
    const slowestQueries = []

    for (const t of traces) {
      if (!queryLatencies[t.query]) {
        queryLatencies[t.query] = { count: 0, total: 0 }
      }
      queryLatencies[t.query].count++
      queryLatencies[t.query].total += t.totalTime

      for (const p of (t.providersUsed || [])) {
        if (!providerLatencies[p]) {
          providerLatencies[p] = { count: 0, total: 0 }
        }
        providerLatencies[p].count++
        providerLatencies[p].total += t.totalTime
      }

      slowestQueries.push({ id: t.id, query: t.query, time: t.totalTime, timestamp: t.timestamp })
    }

    slowestQueries.sort((a, b) => b.time - a.time)

    const view = {
      avgLatencyPerQuery: Object.fromEntries(
        Object.entries(queryLatencies).map(([q, stats]) => [q, stats.total / stats.count])
      ),
      avgLatencyPerProvider: Object.fromEntries(
        Object.entries(providerLatencies).map(([p, stats]) => [p, stats.total / stats.count])
      ),
      slowestQueries: slowestQueries.slice(0, 10),
      lastUpdated: new Date().toISOString()
    }

    await cache.redis.set(PERFORMANCE_VIEW_KEY, JSON.stringify(view), 'EX', 3600)
  } catch (err) {
    console.error('Materialized view update failed:', err)
  }
}

async function runAlertsEngine () {
  if (!cache.isRedisHealthy || !cache.redis) return

  try {
    // 9. Alerts Engine: Analyze recent window only (e.g. last 10 minutes)
    const traces = await tracer.getTraces(100)
    const tenMinsAgo = Date.now() - 10 * 60000
    const recentTraces = traces.filter(t => t.startTime > tenMinsAgo)

    const alerts = []

    recentTraces.forEach(t => {
      if (t.totalTime > 2000) {
        alerts.push({ type: 'latency_spike', message: `Query ${t.query} took ${t.totalTime}ms`, traceId: t.id, timestamp: t.timestamp })
      }
      const errStep = t.steps.find(s => s.status === 'error')
      if (errStep) {
        alerts.push({ type: 'provider_error', message: `Error in ${errStep.name} for ${t.query}`, traceId: t.id, timestamp: t.timestamp })
      }
      if (t.providersUsed && t.providersUsed.length === 0 && !t.cacheHit) {
        alerts.push({ type: 'missing_results', message: `No providers returned results for ${t.query}`, traceId: t.id, timestamp: t.timestamp })
      }
    })

    await cache.redis.set(ALERTS_KEY, JSON.stringify({ alerts, lastUpdated: new Date().toISOString() }), 'EX', 3600)
  } catch (err) {
    console.error('Alerts engine failed:', err)
  }
}

function startJobs () {
  const viewInterval = setInterval(() => {
    updateMaterializedViews()
    runAlertsEngine()
  }, JOB_INTERVAL_MS)

  const networkInterval = setInterval(() => {
    networkDiagnostics.refreshNetworkDiagnostics().catch(() => {})
  }, NETWORK_DIAGNOSTICS_INTERVAL_MS)

  const heartbeatInterval = setInterval(heartbeat, 5000)

  // run once on startup
  const startupTimer = setTimeout(() => {
    updateMaterializedViews()
    runAlertsEngine()
    heartbeat()
    networkDiagnostics.refreshNetworkDiagnostics().catch(() => {})
  }, 1000)

  upstreamMonitor.start()

  for (const timer of [viewInterval, networkInterval, heartbeatInterval, startupTimer]) {
    if (timer.unref) {
      timer.unref()
    }
  }
}

async function heartbeat () {
  if (!cache.isRedisHealthy || !cache.redis) return
  try {
    const instanceId = process.env.INSTANCE_ID
    if (!instanceId) return
    const now = Date.now()
    await cache.redis.zadd('cluster:nodes', now, instanceId)
    await cache.redis.zremrangebyscore('cluster:nodes', '-inf', now - 15000)
  } catch (err) {
    // ignore
  }
}

module.exports = { startJobs, ALERTS_KEY, PERFORMANCE_VIEW_KEY }

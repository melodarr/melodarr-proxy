const crypto = require('crypto')
const cache = require('./cache')
const requestContext = require('./utils/request-context')

const MAX_TRACES = 100 // for memory fallback
const TRACE_TTL = 30 * 86400 // 30 days retention configurable via TTL
let memoryTraces = [] // fallback
let traceBuffer = []
const BATCH_SIZE = 50

function createTrace (query) {
  // Unify trace id with the inbound requestId when set so logs, ring buffer,
  // tracer, and HTTP response header all share the same identifier. Outside
  // an inbound scope (debug-driven trace creation), fall back to a UUID.
  const requestId = requestContext.getRequestId()
  return {
    id: requestId || crypto.randomUUID(),
    query,
    steps: [],
    startTime: Date.now(),
    totalTime: 0,
    timestamp: new Date().toISOString(),
    providersUsed: [],
    cacheHit: false
  }
}

function addStep (trace, name, duration, status = 'success') {
  if (trace) {
    trace.steps.push({ name, duration, status })
    trace.totalTime = Date.now() - trace.startTime
    if (name === 'cacheCheck' && status === 'hit') trace.cacheHit = true
  }
}

async function finalizeTrace (trace, additionalData = {}) {
  if (!trace) return

  trace.totalTime = Date.now() - trace.startTime
  Object.assign(trace, additionalData)

  traceBuffer.push(trace)

  if (traceBuffer.length >= BATCH_SIZE) {
    await flushTraces()
  }
}

async function flushTraces () {
  if (traceBuffer.length === 0) return
  const batch = [...traceBuffer]
  traceBuffer = []

  if (cache.isRedisHealthy && cache.redis) {
    try {
      const pipeline = cache.redis.pipeline()
      for (const t of batch) {
        const month = t.timestamp.substring(0, 7) // YYYY-MM
        const score = t.startTime

        // 6. Redis Optimization: Store full trace objects separately
        // 8. Retention: Pruning via TTL
        pipeline.setex(`trace:${t.id}`, TRACE_TTL, JSON.stringify(t))

        // 1. Partitioning by timestamp (monthly)
        pipeline.zadd(`traces:timestamp:${month}`, score, t.id)
        pipeline.expire(`traces:timestamp:${month}`, TRACE_TTL)

        // 2. Indexing (query, timestamp DESC, etc.)
        pipeline.zadd(`traces:query:${t.query}`, score, t.id)
        pipeline.expire(`traces:query:${t.query}`, TRACE_TTL)

        pipeline.zadd('traces:recent', score, t.id)
      }

      // Trim global recent to last 1000 to save memory
      pipeline.zremrangebyrank('traces:recent', 0, -1001)

      await pipeline.exec()
      return
    } catch (err) {
      console.error('Failed to flush traces to Redis:', err)
      // Fallback
    }
  }

  // Fallback to memory
  for (const t of batch) {
    memoryTraces.unshift(t)
  }
  if (memoryTraces.length > MAX_TRACES) {
    memoryTraces = memoryTraces.slice(0, MAX_TRACES)
  }
}

// 4. Write Buffering: Flush periodically (every 5s)
const flushInterval = setInterval(flushTraces, 5000)
if (flushInterval.unref) {
  flushInterval.unref()
}

async function getTraces (limit = MAX_TRACES) {
  if (cache.isRedisHealthy && cache.redis) {
    try {
      // 2. Indexing: timestamp DESC
      const traceIds = await cache.redis.zrevrange('traces:recent', 0, limit - 1)
      if (traceIds.length > 0) {
        const traces = await cache.redis.mget(...traceIds.map(id => `trace:${id}`))
        return traces.filter(Boolean).map(t => JSON.parse(t))
      }
      return []
    } catch (err) {
      // fallback
    }
  }
  return memoryTraces.slice(0, limit)
}

async function getTrace (id) {
  if (cache.isRedisHealthy && cache.redis) {
    try {
      const t = await cache.redis.get(`trace:${id}`)
      if (t) return JSON.parse(t)
    } catch (err) {}
  }
  return memoryTraces.find(t => t.id === id)
}

module.exports = { createTrace, addStep, finalizeTrace, getTraces, getTrace, flushTraces }

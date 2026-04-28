const tracer = require('../tracer')
const cache = require('../cache')
const metrics = require('../metrics')
const { aggregateArtist } = require('../providers')
const { discoverArtists, findSongAlbums } = require('../providers/artist-discovery')
const { rankResults } = require('../ranking/engine')
const { enrichResult } = require('../enrichment/pipeline')
const { getSnapshots } = require('../snapshots')
const { buildHealthPayload } = require('./health.controller')
const { testCustomProvider } = require('../providers/custom.provider')

async function getDiff(req, res) {
  const { q } = req.query
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' })

  let type = req.query.type || 'search'
  const snapshots = await getSnapshots(`${type}:${q}`)

  if (!snapshots || snapshots.length < 2) {
    return res.json({ status: 'insufficient_data', message: 'Need at least 2 requests to diff.' })
  }

  const [latest, previous] = snapshots

  const latestAlbums = latest.data.albums || []
  const prevAlbums = previous.data.albums || []

  const latestIds = latestAlbums.map(a => a.id || a.title)
  const prevIds = prevAlbums.map(a => a.id || a.title)

  const added = latestAlbums.filter(a => !prevIds.includes(a.id || a.title))
  const removed = prevAlbums.filter(a => !latestIds.includes(a.id || a.title))

  res.json({
    latestTimestamp: latest.timestamp,
    previousTimestamp: previous.timestamp,
    added,
    removed
  })
}

async function buildPerformancePayload () {
  if (cache.isRedisHealthy && cache.redis) {
    const viewData = await cache.redis.get(require('../jobs').PERFORMANCE_VIEW_KEY)
    if (viewData) {
      return JSON.parse(viewData)
    }
  }

  const traces = await tracer.getTraces()

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

  return {
    avgLatencyPerQuery: Object.fromEntries(
      Object.entries(queryLatencies).map(([q, stats]) => [q, stats.total / stats.count])
    ),
    avgLatencyPerProvider: Object.fromEntries(
      Object.entries(providerLatencies).map(([p, stats]) => [p, stats.total / stats.count])
    ),
    slowestQueries: slowestQueries.slice(0, 10)
  }
}

async function getPerformance(req, res) {
  res.json(await buildPerformancePayload())
}

async function buildAlertsPayload () {
  if (cache.isRedisHealthy && cache.redis) {
    const alertsData = await cache.redis.get(require('../jobs').ALERTS_KEY)
    if (alertsData) {
      return JSON.parse(alertsData)
    }
  }

  const traces = await tracer.getTraces()
  const alerts = []

  traces.forEach(t => {
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

  return { alerts }
}

async function getAlerts(req, res) {
  res.json(await buildAlertsPayload())
}

async function buildRequestsPayload () {
  return await tracer.getTraces()
}

async function getRequests(req, res) {
  res.json(await buildRequestsPayload())
}

async function getRequestById(req, res) {
  const trace = await tracer.getTrace(req.params.id)
  if (!trace) return res.status(404).json({ error: 'Trace not found' })
  res.json(trace)
}

function buildProvidersPayload () {
  return {
    providers: [
      { name: "musicbrainz", status: "active" },
      { name: "discogs", status: "active" },
      { name: "itunes", status: "active" },
      { name: "theaudiodb", status: "active" }
    ]
  }
}

function getProviders(req, res) {
  res.json(buildProvidersPayload())
}

async function buildCacheStatePayload () {
  const isReady = await cache.isReady()

  return {
    health: cache.getHealth(),
    status: {
      redis: isReady ? 'connected' : 'disconnected',
      fallback: isReady ? 'inactive' : 'active'
    },
    isReady,
    redisConnected: isReady,
    stats: cache.getStats ? cache.getStats() : undefined
  }
}

async function getCacheState(req, res) {
  res.json(await buildCacheStatePayload())
}

async function buildOverviewPayload () {
  const [health, performance, providers, cacheState, requests] = await Promise.all([
    buildHealthPayload(),
    buildPerformancePayload(),
    Promise.resolve(buildProvidersPayload()),
    buildCacheStatePayload(),
    buildRequestsPayload()
  ])

  return { health, performance, providers, cache: cacheState, requests }
}

async function getOverview (req, res) {
  res.json(await buildOverviewPayload())
}

const crypto = require('crypto')
const INSTANCE_ID = process.env.INSTANCE_ID || crypto.randomBytes(4).toString('hex')

async function getHealth(req, res) {
  res.json({
    instanceId: INSTANCE_ID,
    redis: cache.isRedisHealthy ? 'up' : 'down',
    fallback: !cache.isRedisHealthy,
    mode: cache.isRedisHealthy ? 'normal' : 'degraded',
    redisConnected: cache.isRedisHealthy
  })
}

async function getCluster(req, res) {
  if (!cache.isRedisHealthy || !cache.redis) {
    return res.json({ nodes: [{ instanceId: INSTANCE_ID, lastSeen: new Date().toISOString() }] })
  }
  try {
    const now = Date.now()
    const activeNodes = await cache.redis.zrangebyscore('cluster:nodes', now - 15000, '+inf', 'WITHSCORES')
    const nodes = []
    for (let i = 0; i < activeNodes.length; i += 2) {
      nodes.push({ instanceId: activeNodes[i], lastSeen: new Date(parseInt(activeNodes[i + 1], 10)).toISOString() })
    }
    res.json({ nodes })
  } catch (err) {
    res.json({ nodes: [{ instanceId: INSTANCE_ID, lastSeen: new Date().toISOString() }] })
  }
}

async function getClusterSummary(req, res) {
  let totalNodes = 1
  let healthyNodes = 1

  if (cache.isRedisHealthy && cache.redis) {
    try {
      const now = Date.now()
      const activeNodes = await cache.redis.zrangebyscore('cluster:nodes', now - 15000, '+inf')
      totalNodes = activeNodes.length || 1
      healthyNodes = activeNodes.length || 1 // Nodes in the set are healthy due to recent heartbeat
    } catch (err) {
      // ignore
    }
  }

  const stats = metrics.getStats()

  res.json({
    totalNodes,
    healthyNodes,
    avgLatency: stats.latency.avgMs,
    cacheHitRate: stats.cache.hitRate || 0,
    mode: cache.isRedisHealthy ? 'normal' : 'degraded',
    redisConnected: cache.isRedisHealthy
  })
}

async function verifyCache(req, res) {
  const { q } = req.query
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' })

  const cacheKey = `artist:${q.toLowerCase().replace(/\s+/g, ' ')}`
  const cachedData = await cache.get(cacheKey)

  const startAgg = Date.now()
  const data = await aggregateArtist(q)

  const rankingInput = {
    query: q,
    results: [
      {
        artistName: data.artistName,
        albums: data.albums.map(album => ({
          title: album.name,
          id: album.ids?.musicbrainzReleaseGroupId || album.ids?.theAudioDbAlbumId || album.ids?.itunesCollectionId || album.ids?.discogsId || album.ids?.musicbrainzAlbumId || '',
          firstReleaseDate: album.year ? String(album.year) : '',
          coverUrl: album.imageUrl || '',
          provider: album.provider || '',
          ids: album.ids || {}
        })),
        providerSources: Array.from(new Set(data.albums.map(a => a.provider))),
        confidence: data.confidence
      }
    ]
  }

  const { results: rankedResults } = rankResults(rankingInput)

  let liveComputed = { artistName: data.artistName, albums: [], confidence: 0, score: 0 }
  if (rankedResults.length > 0) {
    const topResult = rankedResults[0]
    const enrichedTopResult = await enrichResult(topResult, false)
    liveComputed = {
      artistName: enrichedTopResult.artistName,
      albums: enrichedTopResult.albums,
      confidence: enrichedTopResult.confidence,
      score: enrichedTopResult.score
    }
  }

  const cachedSummary = cachedData ? {
    artistName: cachedData.data.artistName,
    albumsCount: cachedData.data.albums?.length || 0,
    confidence: cachedData.data.confidence,
    score: cachedData.data.score,
    generatedAt: cachedData.generatedAt
  } : null

  const liveSummary = {
    artistName: liveComputed.artistName,
    albumsCount: liveComputed.albums?.length || 0,
    confidence: liveComputed.confidence,
    score: liveComputed.score
  }

  let isMatch = false
  if (cachedSummary) {
    isMatch = cachedSummary.albumsCount === liveSummary.albumsCount &&
              cachedSummary.confidence === liveSummary.confidence
  }

  res.json({
    query: q,
    isMatch,
    cached: cachedSummary,
    live: liveSummary,
    computationTimeMs: Date.now() - startAgg
  })
}

async function handleDebugSearch(req, res) {
  const { q } = req.query
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' })

  const trace = tracer.createTrace(q)

  try {
    const startAgg = Date.now()
    const data = await aggregateArtist(q)
    tracer.addStep(trace, 'aggregateArtist', Date.now() - startAgg, 'success')

    const startRank = Date.now()
    const rankingInput = {
      query: q,
      results: [
        {
          artistName: data.artistName,
          albums: data.albums.map(album => ({
            title: album.name,
            id: album.ids?.musicbrainzReleaseGroupId || album.ids?.theAudioDbAlbumId || album.ids?.itunesCollectionId || album.ids?.discogsId || album.ids?.musicbrainzAlbumId || '',
            firstReleaseDate: album.year ? String(album.year) : '',
            coverUrl: album.imageUrl || '',
            provider: album.provider || '',
            ids: album.ids || {}
          })),
          providerSources: Array.from(new Set(data.albums.map(a => a.provider))),
          confidence: data.confidence
        }
      ]
    }
    const { results: rankedResults, debug: rankingDebug } = rankResults(rankingInput)
    tracer.addStep(trace, 'rankResults', Date.now() - startRank, 'success')

    const providersUsed = Array.from(new Set(data.albums.map(a => a.provider)))
    await tracer.finalizeTrace(trace, { providersUsed, cacheHit: false })

    res.json({
      query: q,
      traceId: trace.id,
      rawResults: data,
      normalizedResults: rankedResults,
      ranking: rankingDebug
    })
  } catch (error) {
    tracer.addStep(trace, 'error', 0, 'error')
    await tracer.finalizeTrace(trace, { cacheHit: false })
    res.status(500).json({ error: error.message })
  }
}

async function handleDebugDiscover (req, res) {
  const q = String(req.query.q || '').trim()
  const type = String(req.query.type || 'artist').trim().toLowerCase()

  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter "q"' })
  }

  const trace = tracer.createTrace(`debugDiscover:${type}:${q}`)

  try {
    const startedAt = Date.now()
    const candidates = await discoverArtists({ query: q, type })
    tracer.addStep(trace, 'discoverArtists', Date.now() - startedAt, 'success')
    await tracer.finalizeTrace(trace, { providersUsed: ['musicbrainz'], cacheHit: false })

    res.json({
      query: q,
      type,
      candidates,
      traceId: trace.id
    })
  } catch (error) {
    tracer.addStep(trace, 'error', 0, 'error')
    await tracer.finalizeTrace(trace, { providersUsed: ['musicbrainz'], cacheHit: false })
    res.status(502).json({
      query: q,
      type,
      candidates: [],
      error: error.message
    })
  }
}

async function handleDebugSongAlbums (req, res) {
  const artist = String(req.query.artist || '').trim()
  const song = String(req.query.song || req.query.q || '').trim()

  if (!artist || !song) {
    return res.status(400).json({ error: 'Missing required query parameters: artist and song' })
  }

  const trace = tracer.createTrace(`songAlbums:${artist}:${song}`)

  try {
    const startedAt = Date.now()
    const result = await findSongAlbums({ artist, song })
    tracer.addStep(trace, 'findSongAlbums', Date.now() - startedAt, 'success')
    await tracer.finalizeTrace(trace, { providersUsed: [result.source], cacheHit: false })
    res.json({
      ...result,
      traceId: trace.id
    })
  } catch (error) {
    tracer.addStep(trace, 'error', 0, 'error')
    await tracer.finalizeTrace(trace, { providersUsed: [], cacheHit: false })
    res.status(502).json({
      artist,
      song,
      albums: [],
      error: error.message
    })
  }
}

async function testProviderConfig (req, res) {
  try {
    const result = await testCustomProvider(req.body || {})
    res.json(result)
  } catch (error) {
    res.status(502).json({
      raw: null,
      mapped: { artistName: '', albums: [] },
      errors: [{ field: 'request', message: error.message || 'Provider request failed' }],
      warnings: [],
      details: {
        message: error.message,
        code: error.code || null,
        status: error.response?.status || null,
        url: error.config?.url || null,
        response: error.response?.data || null
      }
    })
  }
}

module.exports = { getRequests, getRequestById, getProviders, getCacheState, handleDebugDiscover, handleDebugSearch, handleDebugSongAlbums, getDiff, getPerformance, getAlerts, getHealth, verifyCache, getCluster, getClusterSummary, getOverview, testProviderConfig }

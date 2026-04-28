const metrics = require('../metrics')
const tracer = require('../tracer')
const cache = require('../cache')
const upstreamService = require('../services/upstream.service')
const { aggregateArtist } = require('../providers')
const { discoverArtists, findSongAlbums } = require('../providers/artist-discovery')
const { rankResults } = require('../ranking/engine')
const { enrichResult } = require('../enrichment/pipeline')
const { getConfigValue } = require('../settings/store')
const logger = require('../utils/logger')
const { saveSnapshot } = require('../snapshots')

const withTimeout = (promise, ms) => {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Upstream request timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer))
}

const queryCounts = new Map()
const inflightRequests = new Map()

async function handleSearch (req, res) {
  const { q } = req.query
  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter "q"' })
  }

  const normalizedQ = String(q).trim().toLowerCase().replace(/\s+/g, ' ')
  const cacheKey = `search:${normalizedQ}`
  const trace = tracer.createTrace(`search:${normalizedQ}`)

  // Check cache
  const startCache = Date.now()
  const cached = await cache.get(cacheKey)
  if (cached) {
    tracer.addStep(trace, 'cacheCheck', Date.now() - startCache, 'hit')
    metrics.recordCache(true)
    await tracer.finalizeTrace(trace, { cacheHit: true })
    res.set('X-Cache-Generated-At', cached.generatedAt)
    const responseData = cached.data
    if (responseData && typeof responseData === 'object') responseData._generatedAt = cached.generatedAt
    return res.json(responseData)
  }

  tracer.addStep(trace, 'cacheCheck', Date.now() - startCache, 'miss')
  metrics.recordCache(false)

  const lockKey = `lock:${cacheKey}`
  let hasLock = false
  const startWait = Date.now()
  const ttlMs = 15000

  let attempt = 0;
  while (Date.now() - startWait < ttlMs) {
    hasLock = await cache.acquireLock(lockKey, ttlMs)
    if (hasLock) break

    attempt++;
    const baseWait = Math.min(100 * Math.pow(2, attempt - 1), 2000);
    const jitter = Math.floor(Math.random() * 50);
    const waitTime = baseWait + jitter;

    tracer.addStep(trace, 'coalesceWait', waitTime, 'wait')
    await new Promise(resolve => setTimeout(resolve, waitTime))

    const cachedData = await cache.get(cacheKey)
    if (cachedData) {
      await tracer.finalizeTrace(trace, { cacheHit: true })
      res.set('X-Cache-Generated-At', cachedData.generatedAt)
      const responseData = { ...cachedData.data, _generatedAt: cachedData.generatedAt }
      return res.json(responseData)
    }
  }

  if (!hasLock) {
    tracer.addStep(trace, 'error', 0, 'timeout')
    await tracer.finalizeTrace(trace, { cacheHit: false })
    return res.status(502).json({ error: 'Failed to acquire distributed lock for upstream fetch' })
  }

  try {
    const startUpstream = Date.now()
    const data = await withTimeout(upstreamService.search(q), 15000)
    tracer.addStep(trace, 'upstreamSearch', Date.now() - startUpstream, 'success')

    // Handle stateless query count for adaptive TTL via Redis/Cache (optional simplified)
    let ttl = 86400 // 24h default

    const startCacheSet = Date.now()
    await cache.set(cacheKey, data, ttl)
    tracer.addStep(trace, 'cacheSet', Date.now() - startCacheSet, 'success')

    const providersUsed = Array.from(new Set(data.albums?.map(a => a.provider) || []))
    await tracer.finalizeTrace(trace, { providersUsed, cacheHit: false })
    await saveSnapshot(`search:${normalizedQ}`, data)

    const responseData = { ...data, _generatedAt: new Date().toISOString() }
    res.set('X-Cache-Generated-At', responseData._generatedAt)
    return res.json(responseData)
  } catch (err) {
    tracer.addStep(trace, 'error', 0, 'error')
    logger.error('Upstream error in handleSearch', {
      context: 'Proxy',
      error: err.message,
      userAgent: req.headers?.['user-agent']
    })
    const diagnostic = {
      message: err.message,
      code: err.code,
      config: err.config
        ? {
            url: err.config.url,
            method: err.config.method,
            headers: err.config.headers,
            params: err.config.params
          }
        : undefined
    }
    await tracer.finalizeTrace(trace, { cacheHit: false })
    return res.status(502).json({ error: 'Failed to fetch from upstream API', details: diagnostic })
  } finally {
    await cache.releaseLock(lockKey)
  }
}

function summarizeProvidersFromAlbums (albums = []) {
  const providerCounts = new Map()

  albums.forEach((album) => {
    if (!album.provider) {
      return
    }

    providerCounts.set(album.provider, (providerCounts.get(album.provider) || 0) + 1)
  })

  return [...providerCounts.entries()].map(([name, albumCount]) => ({
    name,
    albumCount
  }))
}

async function handleArtistLookup (req, res) {
  const term = String(req.query.term || '').trim()
  const isDebug = req.query.debug === 'true'

  if (!term) {
    return res.status(400).json({
      error: 'Missing required query parameter: term'
    })
  }

  const normalizedTerm = term.toLowerCase().replace(/\s+/g, ' ')
  const cacheKey = `artist:${normalizedTerm}`
  const trace = tracer.createTrace(`artistLookup:${normalizedTerm}`)

  const startCache = Date.now()
  const cachedData = await cache.get(cacheKey)

  if (cachedData) {
    tracer.addStep(trace, 'cacheCheck', Date.now() - startCache, 'hit')
    const cachedObj = cachedData.data
    const providers = cachedObj.providers?.length
      ? cachedObj.providers
      : summarizeProvidersFromAlbums(cachedObj.albums)

    metrics.recordCache(true)
    metrics.recordArtistLookup({
      term,
      upstreamCalls: 0,
      providers,
      partial: Boolean(cachedObj.partial),
      statusCode: 200
    })
    res.set('X-Cache', 'HIT')
    res.set('X-Providers', providers.map(provider => provider.name).join(','))
    res.set('X-Cache-Generated-At', cachedData.generatedAt)

    const response = { ...cachedObj, providers }
    if (!isDebug && response.debug) {
      delete response.debug
    }
    response._generatedAt = cachedData.generatedAt

    await tracer.finalizeTrace(trace, { cacheHit: true, providersUsed: providers.map(p => p.name) })
    return res.json(response)
  }

  tracer.addStep(trace, 'cacheCheck', Date.now() - startCache, 'miss')
  metrics.recordCache(false)

  const lockKey = `lock:${cacheKey}`
  let hasLock = false
  const startWait = Date.now()
  const ttlMs = 15000

  let attempt = 0;
  while (Date.now() - startWait < ttlMs) {
    hasLock = await cache.acquireLock(lockKey, ttlMs)
    if (hasLock) break

    attempt++;
    const baseWait = Math.min(100 * Math.pow(2, attempt - 1), 2000);
    const jitter = Math.floor(Math.random() * 50);
    const waitTime = baseWait + jitter;

    tracer.addStep(trace, 'coalesceWait', waitTime, 'wait')
    await new Promise(resolve => setTimeout(resolve, waitTime))

    const cachedDataAfterWait = await cache.get(cacheKey)
    if (cachedDataAfterWait) {
      const cachedObj = cachedDataAfterWait.data
      const providers = cachedObj.providers?.length
        ? cachedObj.providers
        : summarizeProvidersFromAlbums(cachedObj.albums)

      metrics.recordCache(true)
      metrics.recordArtistLookup({
        term,
        upstreamCalls: 0,
        providers,
        partial: Boolean(cachedObj.partial),
        statusCode: 200
      })
      res.set('X-Cache', 'HIT')
      res.set('X-Providers', providers.map(provider => provider.name).join(','))
      res.set('X-Cache-Generated-At', cachedDataAfterWait.generatedAt)

      const response = { ...cachedObj, providers }
      if (!isDebug && response.debug) {
        delete response.debug
      }
      response._generatedAt = cachedDataAfterWait.generatedAt

      await tracer.finalizeTrace(trace, { cacheHit: true, providersUsed: providers.map(p => p.name) })
      return res.json(response)
    }
  }

  if (!hasLock) {
    tracer.addStep(trace, 'error', 0, 'timeout')
    metrics.recordArtistLookup({ term, upstreamCalls: 0, providers: [], partial: true, statusCode: 502, error: 'Lock timeout' })
    await tracer.finalizeTrace(trace, { cacheHit: false })
    return res.status(502).json({ artistName: term, foreignArtistId: '', albums: [], partial: true, warning: 'Upstream request failed during coalescing (lock timeout)' })
  }

  try {
    const startAgg = Date.now()
    const data = await withTimeout(aggregateArtist(term), 15000)
    tracer.addStep(trace, 'aggregateArtist', Date.now() - startAgg, 'success')

    const rankingStartTime = Date.now()

    const rankingInput = {
      query: term,
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
    const rankingTimeMs = Date.now() - rankingStartTime
    tracer.addStep(trace, 'rankResults', rankingTimeMs, 'success')

    const scores = rankedResults.map(r => r.score)
    const topConfidence = rankedResults[0]?.confidence || 0
    metrics.recordRanking(rankingTimeMs, scores, topConfidence)

    const topResult = rankedResults[0]

    // Enrichment Pipeline
    const startEnrich = Date.now()
    const enrichedTopResult = await enrichResult(topResult, isDebug)
    tracer.addStep(trace, 'enrichResult', Date.now() - startEnrich, 'success')

    const response = {
      artistName: enrichedTopResult.artistName,
      foreignArtistId: '',
      albums: enrichedTopResult.albums,
      tags: enrichedTopResult.tags,
      genres: enrichedTopResult.genres,
      popularity: enrichedTopResult.popularity,
      providers: data.providers,
      providerErrors: data.providerErrors,
      partial: data.partial,
      warning: data.warning,
      confidence: enrichedTopResult.confidence,
      score: enrichedTopResult.score,
      results: rankedResults
    }

    if (isDebug) {
      response.debug = {
        ranking: rankingDebug,
        enrichment: enrichedTopResult._enrichmentDebug
      }
      // Clean up internal property
      delete enrichedTopResult._enrichmentDebug
    }

    const startCacheSet = Date.now()
    await cache.set(cacheKey, response, getConfigValue('cacheTtlSeconds'))
    tracer.addStep(trace, 'cacheSet', Date.now() - startCacheSet, 'success')

    await saveSnapshot(`artist:${normalizedTerm}`, response)

    metrics.recordArtistLookup({
      term,
      upstreamCalls: data.providerCount,
      providers: data.providers,
      partial: data.partial,
      statusCode: 200,
      error: data.warning
    })

    res.set('X-Cache', 'MISS')
    res.set('X-Upstream-Calls', String(data.providerCount))
    res.set('X-Providers', data.providers.map(provider => provider.name).join(','))
    res.set('X-Cache-Generated-At', new Date().toISOString())

    const finalResponse = { ...response, _generatedAt: new Date().toISOString() }
    if (!isDebug && finalResponse.debug) {
      delete finalResponse.debug
    }

    await tracer.finalizeTrace(trace, { cacheHit: false, providersUsed: data.providers.map(p => p.name) })
    return res.json(finalResponse)
  } catch (error) {
    tracer.addStep(trace, 'error', 0, 'error')
    logger.error('Artist lookup failed', {
      context: 'Proxy',
      error: error.message
    })

    metrics.recordArtistLookup({
      term,
      upstreamCalls: 0,
      providers: [],
      partial: true,
      statusCode: 502,
      error: error.message
    })

    await tracer.finalizeTrace(trace, { cacheHit: false })

    return res.status(502).json({
      artistName: term,
      foreignArtistId: '',
      albums: [],
      partial: true,
      warning: error.message,
      details: {
        message: error.message,
        code: error.code
      }
    })
  } finally {
    await cache.releaseLock(lockKey)
  }
}

async function handleArtistDiscover (req, res) {
  const query = String(req.query.q || req.query.term || '').trim()
  const type = String(req.query.type || 'artist').trim().toLowerCase()
  const trace = tracer.createTrace(`artistDiscover:${type}:${query.toLowerCase().replace(/\s+/g, ' ')}`)

  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter "q"' })
  }

  try {
    const startedAt = Date.now()
    const candidates = await withTimeout(discoverArtists({ query, type }), 15000)
    tracer.addStep(trace, 'discoverArtists', Date.now() - startedAt, 'success')
    await tracer.finalizeTrace(trace, {
      cacheHit: false,
      providersUsed: ['musicbrainz']
    })

    return res.json({
      query,
      type,
      candidates
    })
  } catch (error) {
    tracer.addStep(trace, 'error', 0, 'error')
    await tracer.finalizeTrace(trace, { cacheHit: false, providersUsed: ['musicbrainz'] })
    return res.status(502).json({
      query,
      type,
      candidates: [],
      error: error.message,
      details: {
        message: error.message,
        code: error.code,
        status: error.response?.status || null
      }
    })
  }
}

async function handleSongAlbums (req, res) {
  const artist = String(req.query.artist || '').trim()
  const song = String(req.query.song || req.query.q || '').trim()
  const trace = tracer.createTrace(`songAlbums:${artist}:${song}`)

  if (!artist || !song) {
    return res.status(400).json({ error: 'Missing required query parameters: artist and song' })
  }

  try {
    const startedAt = Date.now()
    const result = await withTimeout(findSongAlbums({ artist, song }), 15000)
    tracer.addStep(trace, 'findSongAlbums', Date.now() - startedAt, 'success')
    await tracer.finalizeTrace(trace, { cacheHit: false, providersUsed: [result.source] })
    return res.json(result)
  } catch (error) {
    tracer.addStep(trace, 'error', 0, 'error')
    await tracer.finalizeTrace(trace, { cacheHit: false })
    return res.status(502).json({
      artist,
      song,
      albums: [],
      error: error.message
    })
  }
}

module.exports = { handleArtistDiscover, handleArtistLookup, handleSearch, handleSongAlbums }

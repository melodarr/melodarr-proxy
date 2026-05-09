const metrics = require('../metrics')
const tracer = require('../tracer')
const cache = require('../cache')
const providers = require('../providers')
const musicbrainzProvider = require('../providers/musicbrainz.provider')
const theAudioDbProvider = require('../providers/theaudiodb.provider')
const artistDiscovery = require('../providers/artist-discovery')
const rankingEngine = require('../ranking/engine')
const enrichment = require('../enrichment/pipeline')
const { getConfigValue } = require('../settings/store')
const logger = require('../utils/logger')
const { saveSnapshot } = require('../snapshots')
const { toIsoDate } = require('../utils/dates')
const { toSkyhookSearchShape } = require('../utils/skyhook')
const { isValidArtist } = require('../utils/validateArtist')
const {
  normalizeAlbum,
  normalizeStringArray,
  toSkyhookAlbumResource,
  toSkyhookArtistResource,
  withArtistLookupDefaults,
  withSkyhookArtistDefaults,
  LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS,
  LIDARR_OPTIONAL_ARTIST_KEYS
} = require('../utils/lidarrArtist')

function stripInternalKeys (response) {
  const allowed = new Set([...LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS, ...LIDARR_OPTIONAL_ARTIST_KEYS])
  const cleaned = {}
  for (const key of Object.keys(response)) {
    if (allowed.has(key)) {
      cleaned[key] = response[key]
    }
  }
  return cleaned
}

const withTimeout = (promise, ms) => {
  let timer
  const timeoutPromise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Upstream request timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer))
}

function normalizeAlbumResponse (album = {}) {
  const normalized = normalizeAlbum(album)
  const artist = normalized.artist ? withSkyhookArtistDefaults(normalized.artist) : null
  const artists = Array.isArray(normalized.artists)
    ? normalized.artists.map(item => withSkyhookArtistDefaults(item))
    : []

  return toSkyhookAlbumResource({
    ...normalized,
    firstReleaseDate: toIsoDate(normalized.firstReleaseDate || normalized.releaseDate),
    releaseDate: toIsoDate(normalized.releaseDate),
    artist: artist || normalized.artist,
    artists: artists.length > 0 ? artists : (artist ? [artist] : [])
  })
}

async function cacheAlbumResponses (albums = []) {
  await Promise.all(albums
    .map(album => normalizeAlbumResponse(album))
    .filter(album => album.id && album.releases.length > 0)
    .map(album => cache.set(`album-id:${album.id}`, album, 86400 * 30)))
}

async function handleSearch (req, res) {
  const q = req.query.q || req.query.query || req.query.term
  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter "q" or "query"' })
  }
  const type = req.query.type || 'all'

  const normalizedQ = String(q).trim().toLowerCase().replace(/\s+/g, ' ')
  const cacheKey = `search:${normalizedQ}`
  const trace = tracer.createTrace(`search:${normalizedQ}`)

  // Check cache
  const startCache = Date.now()
  const cached = await cache.get(cacheKey)
  if (cached) {
    const isStale = (Date.now() - new Date(cached.generatedAt).getTime()) > (getConfigValue('cacheTtlSeconds') * 1000)
    tracer.addStep(trace, 'cacheCheck', Date.now() - startCache, isStale ? 'hit-stale' : 'hit')
    metrics.recordCache(true, isStale)
    await tracer.finalizeTrace(trace, { cacheHit: true })
    res.set('X-Cache-Generated-At', cached.generatedAt)
    return res.json(toSkyhookSearchShape(cached.data, type).filter(isValidArtist))
  }

  tracer.addStep(trace, 'cacheCheck', Date.now() - startCache, 'miss')
  metrics.recordCache(false)

  const lockKey = `lock:${cacheKey}`
  let hasLock = false
  let lockToken = null
  const startWait = Date.now()
  const ttlMs = 15000

  let attempt = 0
  while (Date.now() - startWait < ttlMs) {
    lockToken = await cache.acquireLock(lockKey, ttlMs)
    hasLock = Boolean(lockToken)
    if (hasLock) break

    attempt++
    const baseWait = Math.min(100 * Math.pow(2, attempt - 1), 2000)
    const jitter = Math.floor(Math.random() * 50)
    const waitTime = baseWait + jitter

    tracer.addStep(trace, 'coalesceWait', waitTime, 'wait')
    metrics.recordLockWait(waitTime)
    await new Promise(resolve => setTimeout(resolve, waitTime))

    const cachedData = await cache.get(cacheKey)
    if (cachedData) {
      const isStale = (Date.now() - new Date(cachedData.generatedAt).getTime()) > (getConfigValue('cacheTtlSeconds') * 1000)
      metrics.recordCache(true, isStale)
      await tracer.finalizeTrace(trace, { cacheHit: true })
      res.set('X-Cache-Generated-At', cachedData.generatedAt)
      return res.json(toSkyhookSearchShape(cachedData.data, type).filter(isValidArtist))
    }
  }

  if (!hasLock) {
    tracer.addStep(trace, 'error', 0, 'timeout')
    await tracer.finalizeTrace(trace, { cacheHit: false })
    return res.status(200).json([])
  }

  try {
    const startAgg = Date.now()
    const data = await withTimeout(artistDiscovery.discoverArtists({ query: q, type }), 15000)
    tracer.addStep(trace, 'discoverArtists', Date.now() - startAgg, 'success')

    // Use a shorter negative cache TTL (5 minutes) for empty results
    const ttl = (!data || data.length === 0) ? 300 : 86400 * 30 // 5m negative cache, 30d SWR

    const startCacheSet = Date.now()
    await cache.set(cacheKey, data, ttl)
    tracer.addStep(trace, 'cacheSet', Date.now() - startCacheSet, 'success')

    const providersUsed = ['musicbrainz']
    await tracer.finalizeTrace(trace, { providersUsed, cacheHit: false })
    await saveSnapshot(`search:${normalizedQ}`, data)

    res.set('X-Cache-Generated-At', new Date().toISOString())
    return res.json(toSkyhookSearchShape(data, type).filter(isValidArtist))
  } catch (err) {
    tracer.addStep(trace, 'error', 0, 'error')
    logger.error('Upstream error in handleSearch', {
      context: 'Proxy',
      error: err.message,
      code: err.code,
      userAgent: req.headers?.['user-agent']
    })
    // Client-facing body MUST NOT include err.config (URL, headers, params,
    // User-Agent — the User-Agent contains the operator's contact email).
    // Diagnostics for operators live in the structured log line above and in
    // the /debug/upstream ring buffer, never in the response.
    await tracer.finalizeTrace(trace, { cacheHit: false })
    return res.status(200).json([])
  } finally {
    await cache.releaseLock(lockKey, lockToken)
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

function buildArtistLookupRankingInput (term, data) {
  const artistId = data.id || data.foreignArtistId || ''
  const nestedArtist = withSkyhookArtistDefaults({
    artistName: data.artistName,
    id: artistId,
    foreignArtistId: artistId,
    disambiguation: data.disambiguation || '',
    overview: data.overview || '',
    type: data.type || 'Group',
    status: data.status || 'active',
    oldIds: normalizeStringArray(data.oldIds),
    aliases: normalizeStringArray(data.artistAliases || data.aliases),
    artistAliases: normalizeStringArray(data.artistAliases || data.aliases),
    links: data.links || [],
    images: data.images || [],
    albums: []
  })

  return {
    query: term,
    results: [
      {
        artistName: data.artistName,
        albums: data.albums.map(album => ({
          artistId,
          artist: nestedArtist,
          artists: [nestedArtist],
          title: album.name,
          id: album.ids?.musicbrainzReleaseGroupId || album.ids?.theAudioDbAlbumId || album.ids?.itunesCollectionId || album.ids?.discogsId || album.ids?.musicbrainzAlbumId || '',
          firstReleaseDate: toIsoDate(album.releaseDate || album.year),
          releaseDate: toIsoDate(album.releaseDate || album.year),
          images: album.imageUrl ? [{ coverType: 'cover', url: album.imageUrl, remoteUrl: album.imageUrl }] : [],
          remoteCover: album.imageUrl || '',
          rating: album.rating || album.ratings,
          ratings: album.ratings || album.rating,
          provider: album.provider || '',
          ids: album.ids || {}
        })).map(normalizeAlbum),
        providerSources: Array.from(new Set(data.albums.map(a => a.provider))),
        confidence: data.confidence
      }
    ]
  }
}

function buildArtistLookupResponse (data, enrichedTopResult, rankedResults) {
  return withArtistLookupDefaults({
    artistName: enrichedTopResult.artistName,
    id: data.id || '',
    foreignArtistId: data.id || '',
    disambiguation: data.disambiguation || '',
    overview: data.overview || '',
    status: data.status || 'continuing',
    oldIds: normalizeStringArray(data.oldIds),
    aliases: normalizeStringArray(data.aliases),
    links: firstNonEmptyArray(data.links, enrichedTopResult.links),
    images: data.images || [],
    albums: enrichedTopResult.albums,
    tags: enrichedTopResult.tags,
    genres: firstNonEmptyArray(data.genres, enrichedTopResult.genres),
    popularity: enrichedTopResult.popularity,
    providers: data.providers,
    providerErrors: data.providerErrors,
    partial: data.partial,
    warning: data.warning,
    confidence: enrichedTopResult.confidence,
    score: enrichedTopResult.score,
    results: rankedResults
  })
}

function firstNonEmptyArray (...values) {
  return values.find(value => Array.isArray(value) && value.length > 0) || []
}

function mergeArtistByIdEnrichment (base = {}, enrichment = {}) {
  const aliases = firstNonEmptyArray(base.artistAliases, base.aliases, enrichment.artistAliases, enrichment.aliases)

  return {
    ...base,
    overview: base.overview || enrichment.overview || '',
    disambiguation: base.disambiguation || enrichment.disambiguation || '',
    oldIds: firstNonEmptyArray(base.oldIds, enrichment.oldIds),
    aliases,
    artistAliases: aliases,
    links: firstNonEmptyArray(base.links, enrichment.links),
    genres: firstNonEmptyArray(base.genres, enrichment.genres),
    images: firstNonEmptyArray(base.images, enrichment.images),
    rating: base.rating || enrichment.rating || enrichment.ratings,
    ratings: base.ratings || enrichment.ratings || enrichment.rating
  }
}

function hasArtistImages (data = {}) {
  return Array.isArray(data.images) && data.images.length > 0
}

function needsArtistEnrichment (data = {}) {
  return !hasArtistImages(data) ||
    !data.overview ||
    !Array.isArray(data.links) || data.links.length === 0 ||
    !Array.isArray(data.genres) || data.genres.length === 0
}

function isMatchingArtistEnrichment (base = {}, enrichment = {}) {
  const enrichmentMbid = enrichment.id || enrichment.foreignArtistId || enrichment.ids?.musicbrainzArtistId
  return !enrichmentMbid || !base.id || enrichmentMbid === base.id
}

async function tryAggregateArtistImageEnrichment (data) {
  try {
    const enrichment = await withTimeout(providers.aggregateArtist(data.artistName), 15000)
    if (!enrichment || !hasArtistImages(enrichment)) {
      return data
    }

    if (!isMatchingArtistEnrichment(data, enrichment)) {
      logger.warn('Artist by ID aggregate enrichment skipped: MBID mismatch', {
        context: 'Proxy',
        artistName: data.artistName,
        requestedId: data.id,
        enrichmentId: enrichment.id || enrichment.foreignArtistId || enrichment.ids?.musicbrainzArtistId || null
      })
      return data
    }

    return mergeArtistByIdEnrichment(data, enrichment)
  } catch (error) {
    logger.warn('Artist by ID aggregate enrichment skipped', {
      context: 'Proxy',
      artistName: data.artistName,
      error: error.message,
      code: error.code
    })
    return data
  }
}

async function tryEnrichArtistByIdData (data) {
  if (!data?.artistName) {
    return data
  }

  if (!needsArtistEnrichment(data)) {
    return data
  }

  try {
    const enrichment = await withTimeout(theAudioDbProvider.searchArtistProfile(data.artistName), 10000)
    if (!enrichment) {
      return tryAggregateArtistImageEnrichment(data)
    }

    if (!isMatchingArtistEnrichment(data, enrichment)) {
      logger.warn('Artist by ID enrichment skipped: TheAudioDB MBID mismatch', {
        context: 'Proxy',
        artistName: data.artistName,
        requestedId: data.id,
        theAudioDbMbid: enrichment.ids?.musicbrainzArtistId || null
      })
      return tryAggregateArtistImageEnrichment(data)
    }

    const enrichedData = mergeArtistByIdEnrichment(data, enrichment)
    return hasArtistImages(enrichedData) ? enrichedData : tryAggregateArtistImageEnrichment(enrichedData)
  } catch (error) {
    logger.warn('Artist by ID enrichment skipped', {
      context: 'Proxy',
      artistName: data.artistName,
      error: error.message,
      code: error.code
    })
    return tryAggregateArtistImageEnrichment(data)
  }
}

async function executeArtistLookupPipeline (term, isDebug, cacheKey, normalizedTerm, trace) {
  const startAgg = Date.now()
  const data = await withTimeout(providers.aggregateArtist(term), 15000)
  tracer.addStep(trace, 'aggregateArtist', Date.now() - startAgg, 'success')

  const rankingStartTime = Date.now()

  const rankingInput = buildArtistLookupRankingInput(term, data)

  const { results: rankedResults, debug: rankingDebug } = rankingEngine.rankResults(rankingInput)
  const rankingTimeMs = Date.now() - rankingStartTime
  tracer.addStep(trace, 'rankResults', rankingTimeMs, 'success')

  const scores = rankedResults.map(r => r.score)
  const topConfidence = rankedResults[0]?.confidence || 0
  metrics.recordRanking(rankingTimeMs, scores, topConfidence)

  const topResult = rankedResults[0]

  // Enrichment Pipeline
  const startEnrich = Date.now()
  const enrichedTopResult = await enrichment.enrichResult(topResult, isDebug)
  tracer.addStep(trace, 'enrichResult', Date.now() - startEnrich, 'success')

  const response = buildArtistLookupResponse(data, enrichedTopResult, rankedResults)

  if (isDebug) {
    response.debug = {
      ranking: rankingDebug,
      enrichment: enrichedTopResult._enrichmentDebug
    }
    delete enrichedTopResult._enrichmentDebug
  }

  // Use a shorter negative cache TTL (5 minutes) for empty results
  // Check if we have valid artist data (non-empty artistName and id)
  const hasValidArtist = response.artistName && response.artistName.trim().length > 0 &&
                         (response.foreignArtistId || response.id)
  const SWR_TTL_SECONDS = hasValidArtist ? 86400 * 30 : 300 // 5m negative cache, 30d SWR
  const startCacheSet = Date.now()
  await cache.set(cacheKey, response, SWR_TTL_SECONDS)
  tracer.addStep(trace, 'cacheSet', Date.now() - startCacheSet, 'success')

  await saveSnapshot(`artist:${normalizedTerm}`, response)

  return { response, data }
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
    const isStale = (Date.now() - new Date(cachedData.generatedAt).getTime()) > (getConfigValue('cacheTtlSeconds') * 1000)

    if (isStale) {
      const swrLockKey = `swr:${cacheKey}`
      cache.acquireLock(swrLockKey, 30000).then(async (lockToken) => {
        if (!lockToken) return
        try {
          const bgTrace = tracer.createTrace(`artistLookupSWR:${normalizedTerm}`)
          const { data } = await executeArtistLookupPipeline(term, isDebug, cacheKey, normalizedTerm, bgTrace)
          await tracer.finalizeTrace(bgTrace, { cacheHit: false, providersUsed: data.providers.map(p => p.name) })
        } catch (err) {
          logger.error('Background refresh failed', { context: 'SWR', error: err.message, term })
        } finally {
          await cache.releaseLock(swrLockKey, lockToken)
        }
      }).catch(() => {})
    }

    tracer.addStep(trace, 'cacheCheck', Date.now() - startCache, isStale ? 'hit-stale' : 'hit')
    const cachedObj = cachedData.data
    const providers = cachedObj.providers?.length
      ? cachedObj.providers
      : summarizeProvidersFromAlbums(cachedObj.albums)

    metrics.recordCache(true, isStale)
    metrics.recordArtistLookup({
      term,
      upstreamCalls: 0,
      providers,
      partial: Boolean(cachedObj.partial),
      statusCode: 200
    })
    res.set('X-Cache', 'HIT')
    const providerHeader = providers.length ? providers.map(provider => provider.name).join(',') : 'unknown'
    res.set('X-Providers', providerHeader)
    res.set('X-Cache-Generated-At', cachedData.generatedAt)

    const response = withArtistLookupDefaults({ ...cachedObj, providers })
    if (!isDebug && response.debug) {
      delete response.debug
    }
    response._generatedAt = cachedData.generatedAt

    await tracer.finalizeTrace(trace, { cacheHit: true, providersUsed: providers.map(p => p.name) })

    const finalResponse = isDebug ? response : stripInternalKeys(response)
    return res.json([finalResponse].filter(isValidArtist))
  }

  tracer.addStep(trace, 'cacheCheck', Date.now() - startCache, 'miss')
  metrics.recordCache(false)

  const lockKey = `lock:${cacheKey}`
  let hasLock = false
  let lockToken = null
  const startWait = Date.now()
  const ttlMs = 15000

  let attempt = 0
  while (Date.now() - startWait < ttlMs) {
    lockToken = await cache.acquireLock(lockKey, ttlMs)
    hasLock = Boolean(lockToken)
    if (hasLock) break

    attempt++
    const baseWait = Math.min(100 * Math.pow(2, attempt - 1), 2000)
    const jitter = Math.floor(Math.random() * 50)
    const waitTime = baseWait + jitter

    tracer.addStep(trace, 'coalesceWait', waitTime, 'wait')
    metrics.recordLockWait(waitTime)
    await new Promise(resolve => setTimeout(resolve, waitTime))

    const cachedDataAfterWait = await cache.get(cacheKey)
    if (cachedDataAfterWait) {
      const cachedObj = cachedDataAfterWait.data
      const providers = cachedObj.providers?.length
        ? cachedObj.providers
        : summarizeProvidersFromAlbums(cachedObj.albums)

      const isStale = (Date.now() - new Date(cachedDataAfterWait.generatedAt).getTime()) > (getConfigValue('cacheTtlSeconds') * 1000)
      metrics.recordCache(true, isStale)
      metrics.recordArtistLookup({
        term,
        upstreamCalls: 0,
        providers,
        partial: Boolean(cachedObj.partial),
        statusCode: 200
      })
      res.set('X-Cache', 'HIT')
      const providerHeader = providers.length ? providers.map(provider => provider.name).join(',') : 'unknown'
      res.set('X-Providers', providerHeader)
      res.set('X-Cache-Generated-At', cachedDataAfterWait.generatedAt)

      const response = withArtistLookupDefaults({ ...cachedObj, providers })
      if (!isDebug && response.debug) {
        delete response.debug
      }
      response._generatedAt = cachedDataAfterWait.generatedAt

      await tracer.finalizeTrace(trace, { cacheHit: true, providersUsed: providers.map(p => p.name) })

      const finalResponse = isDebug ? response : stripInternalKeys(response)
      return res.json([finalResponse].filter(isValidArtist))
    }
  }

  if (!hasLock) {
    tracer.addStep(trace, 'error', 0, 'timeout')
    metrics.recordArtistLookup({ term, upstreamCalls: 0, providers: [], partial: true, statusCode: 200, error: 'Lock timeout' })
    await tracer.finalizeTrace(trace, { cacheHit: false })
    return res.status(200).json([])
  }

  try {
    const { response, data } = await executeArtistLookupPipeline(term, isDebug, cacheKey, normalizedTerm, trace)

    const resolvedProviders = data.providers?.length
      ? data.providers
      : summarizeProvidersFromAlbums(data.albums || [])

    metrics.recordArtistLookup({
      term,
      upstreamCalls: data.providerCount || 0,
      providers: resolvedProviders,
      partial: Boolean(data.partial),
      statusCode: 200,
      error: data.warning
    })

    res.set('X-Cache', 'MISS')
    res.set('X-Upstream-Calls', String(data.providerCount || 0))
    const providerHeader = resolvedProviders.length ? resolvedProviders.map(provider => provider.name).join(',') : 'unknown'
    res.set('X-Providers', providerHeader)
    res.set('X-Cache-Generated-At', new Date().toISOString())

    const finalResponse = { ...response, _generatedAt: new Date().toISOString() }
    if (!isDebug && finalResponse.debug) {
      delete finalResponse.debug
    }

    await tracer.finalizeTrace(trace, { cacheHit: false, providersUsed: resolvedProviders.map(p => p.name) })

    const sanitizedResponse = isDebug ? finalResponse : stripInternalKeys(finalResponse)
    return res.json([sanitizedResponse].filter(isValidArtist))
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
      statusCode: 200,
      error: error.message
    })

    await tracer.finalizeTrace(trace, { cacheHit: false })

    return res.status(200).json([])
  } finally {
    await cache.releaseLock(lockKey, lockToken)
  }
}

async function handleArtistById (req, res) {
  const foreignArtistId = String(req.params.foreignArtistId || req.params.artistId || '').trim()

  if (!foreignArtistId) {
    return res.status(400).json({ error: 'Missing required path parameter: foreignArtistId' })
  }

  const cacheKey = `artist-id:${foreignArtistId}`
  const trace = tracer.createTrace(`artistById:${foreignArtistId}`)

  const startCache = Date.now()
  const cachedData = await cache.get(cacheKey)
  if (cachedData) {
    const isStale = (Date.now() - new Date(cachedData.generatedAt).getTime()) > (getConfigValue('cacheTtlSeconds') * 1000)
    tracer.addStep(trace, 'cacheCheck', Date.now() - startCache, isStale ? 'hit-stale' : 'hit')
    metrics.recordCache(true, isStale)
    const response = toSkyhookArtistResource(cachedData.data)
    await tracer.finalizeTrace(trace, { cacheHit: true, providersUsed: ['musicbrainz'] })
    res.set('X-Cache', 'HIT')
    res.set('X-Providers', 'musicbrainz')
    res.set('X-Cache-Generated-At', cachedData.generatedAt)
    return res.json(response)
  }

  tracer.addStep(trace, 'cacheCheck', Date.now() - startCache, 'miss')
  metrics.recordCache(false)

  try {
    const startedAt = Date.now()
    const data = await withTimeout(musicbrainzProvider.lookupArtistById(foreignArtistId), 15000)
    tracer.addStep(trace, 'lookupArtistById', Date.now() - startedAt, 'success')
    const enrichedData = await tryEnrichArtistByIdData(data)

    const rankingStartTime = Date.now()
    const { results: rankedResults } = rankingEngine.rankResults(buildArtistLookupRankingInput(enrichedData.artistName || foreignArtistId, enrichedData))
    const rankingTimeMs = Date.now() - rankingStartTime
    tracer.addStep(trace, 'rankResults', rankingTimeMs, 'success')

    const topResult = rankedResults[0]
    const startEnrich = Date.now()
    const enrichedTopResult = await enrichment.enrichResult(topResult, false)
    tracer.addStep(trace, 'enrichResult', Date.now() - startEnrich, 'success')

    const response = toSkyhookArtistResource(buildArtistLookupResponse(enrichedData, enrichedTopResult, rankedResults))

    await cache.set(cacheKey, response, 86400 * 30)
    await cacheAlbumResponses(response.albums)
    await tracer.finalizeTrace(trace, { cacheHit: false, providersUsed: ['musicbrainz'] })

    res.set('X-Cache', 'MISS')
    res.set('X-Upstream-Calls', '1')
    res.set('X-Providers', 'musicbrainz')
    res.set('X-Cache-Generated-At', new Date().toISOString())
    return res.json(response)
  } catch (error) {
    tracer.addStep(trace, 'error', 0, 'error')
    logger.error('Artist by ID lookup failed', {
      context: 'Proxy',
      foreignArtistId,
      error: error.message,
      code: error.code
    })
    await tracer.finalizeTrace(trace, { cacheHit: false, providersUsed: ['musicbrainz'] })

    if (error.code === 'ARTIST_NOT_FOUND' || error.response?.status === 404) {
      return res.status(404).json({ error: 'Artist not found', id: foreignArtistId })
    }

    return res.status(502).json({
      error: 'Failed to fetch artist from upstream API',
      details: { message: error.message, code: error.code || null }
    })
  }
}

async function handleAlbumById (req, res) {
  const foreignAlbumId = String(req.params.foreignAlbumId || req.params.albumId || '').trim()

  if (!foreignAlbumId) {
    return res.status(400).json({ error: 'Missing required path parameter: foreignAlbumId' })
  }

  const cacheKey = `album-id:${foreignAlbumId}`
  const trace = tracer.createTrace(`albumById:${foreignAlbumId}`)

  const startCache = Date.now()
  const cachedData = await cache.get(cacheKey)
  if (cachedData) {
    const isStale = (Date.now() - new Date(cachedData.generatedAt).getTime()) > (getConfigValue('cacheTtlSeconds') * 1000)
    tracer.addStep(trace, 'cacheCheck', Date.now() - startCache, isStale ? 'hit-stale' : 'hit')
    metrics.recordCache(true, isStale)
    await tracer.finalizeTrace(trace, { cacheHit: true, providersUsed: ['musicbrainz'] })
    res.set('X-Cache', 'HIT')
    res.set('X-Providers', 'musicbrainz')
    res.set('X-Cache-Generated-At', cachedData.generatedAt)
    return res.json(normalizeAlbumResponse({ ...cachedData.data, _generatedAt: cachedData.generatedAt }))
  }

  tracer.addStep(trace, 'cacheCheck', Date.now() - startCache, 'miss')
  metrics.recordCache(false)

  const lockKey = `lock:${cacheKey}`
  let lockToken = null
  const startWait = Date.now()
  const ttlMs = 15000
  let attempt = 0

  while (Date.now() - startWait < ttlMs) {
    lockToken = await cache.acquireLock(lockKey, ttlMs)
    if (lockToken) break

    attempt++
    const waitTime = Math.min(100 * Math.pow(2, attempt - 1), 2000) + Math.floor(Math.random() * 50)
    tracer.addStep(trace, 'coalesceWait', waitTime, 'wait')
    metrics.recordLockWait(waitTime)
    await new Promise(resolve => setTimeout(resolve, waitTime))

    const cachedDataAfterWait = await cache.get(cacheKey)
    if (cachedDataAfterWait) {
      metrics.recordCache(true, false)
      await tracer.finalizeTrace(trace, { cacheHit: true, providersUsed: ['musicbrainz'] })
      res.set('X-Cache', 'HIT')
      res.set('X-Providers', 'musicbrainz')
      res.set('X-Cache-Generated-At', cachedDataAfterWait.generatedAt)
      return res.json(normalizeAlbumResponse({ ...cachedDataAfterWait.data, _generatedAt: cachedDataAfterWait.generatedAt }))
    }
  }

  if (!lockToken) {
    tracer.addStep(trace, 'error', 0, 'timeout')
    await tracer.finalizeTrace(trace, { cacheHit: false, providersUsed: ['musicbrainz'] })
    return res.status(502).json({
      error: 'Failed to fetch album from upstream API',
      details: { message: 'Upstream request failed during coalescing (lock timeout)', code: 'LOCK_TIMEOUT' }
    })
  }

  try {
    const startedAt = Date.now()
    const data = await withTimeout(musicbrainzProvider.lookupAlbumById(foreignAlbumId), 15000)
    tracer.addStep(trace, 'lookupAlbumById', Date.now() - startedAt, 'success')
    const response = normalizeAlbumResponse(data)

    await cache.set(cacheKey, response, 86400 * 30)
    await tracer.finalizeTrace(trace, { cacheHit: false, providersUsed: ['musicbrainz'] })

    res.set('X-Cache', 'MISS')
    res.set('X-Upstream-Calls', '1')
    res.set('X-Providers', 'musicbrainz')
    res.set('X-Cache-Generated-At', new Date().toISOString())
    return res.json(response)
  } catch (error) {
    tracer.addStep(trace, 'error', 0, 'error')
    logger.error('Album by ID lookup failed', {
      context: 'Proxy',
      foreignAlbumId,
      error: error.message,
      code: error.code
    })
    await tracer.finalizeTrace(trace, { cacheHit: false, providersUsed: ['musicbrainz'] })

    if (error.code === 'ALBUM_NOT_FOUND' || error.response?.status === 404) {
      return res.status(404).json({ error: 'Album not found', id: foreignAlbumId })
    }

    return res.status(502).json({
      error: 'Failed to fetch album from upstream API',
      details: { message: error.message, code: error.code || null }
    })
  } finally {
    await cache.releaseLock(lockKey, lockToken)
  }
}

function handleRecentFeed (_req, res) {
  return res.json([])
}

function handleReleaseSearch (_req, res) {
  return res.json([])
}

function handleQueueDetails (_req, res) {
  return res.json([])
}

async function handleArtistDiscover (req, res) {
  const query = String(req.query.q || req.query.term || '').trim()
  const type = String(req.query.type || 'artist').trim().toLowerCase()
  const trace = tracer.createTrace(`artistDiscover:${type}:${query.toLowerCase().replace(/\s+/g, ' ')}`)

  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter "q"' })
  }

  const providersTried = Array.from(artistDiscovery.getEnabledProviders())

  try {
    const startedAt = Date.now()
    const candidates = await withTimeout(artistDiscovery.discoverArtists({ query, type }), 15000)
    tracer.addStep(trace, 'discoverArtists', Date.now() - startedAt, 'success')
    await tracer.finalizeTrace(trace, {
      cacheHit: false,
      providersUsed: providersTried
    })

    const wrappedCandidates = toSkyhookSearchShape(candidates, type).filter(isValidArtist)
    return res.json({
      query,
      type,
      candidates: wrappedCandidates,
      providers: providersTried,
      partial: wrappedCandidates.length === 0,
      warning: wrappedCandidates.length === 0 ? 'No candidates returned from any configured provider' : null
    })
  } catch (error) {
    tracer.addStep(trace, 'error', 0, 'error')
    await tracer.finalizeTrace(trace, { cacheHit: false, providersUsed: providersTried })
    // Defensive 502 — discoverArtists now returns [] for provider failures, so
    // reaching here means an unexpected exception (e.g. timeout). Body is
    // intentionally minimal: no err.config, no headers, no upstream URL.
    return res.status(502).json({
      query,
      type,
      candidates: [],
      providers: providersTried,
      partial: true,
      error: 'Discovery failed',
      details: { message: error.message, code: error.code || null }
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
    const result = await withTimeout(artistDiscovery.findSongAlbums({ artist, song }), 15000)
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

module.exports = { handleAlbumById, handleArtistById, handleArtistDiscover, handleArtistLookup, handleQueueDetails, handleRecentFeed, handleReleaseSearch, handleSearch, handleSongAlbums }

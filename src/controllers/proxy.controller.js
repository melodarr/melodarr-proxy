const metrics = require('../metrics')
const cache = require('../cache')
const upstreamService = require('../services/upstream.service')
const { aggregateArtist } = require('../providers')
const { rankResults } = require('../ranking/engine')
const { enrichResult } = require('../enrichment/pipeline')
const { getConfigValue } = require('../settings/store')
const logger = require('../utils/logger')

// Bonus: Track top queries and repeated queries
const queryCounts = new Map()

async function handleSearch (req, res) {
  const { q } = req.query
  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter "q"' })
  }

  const cacheKey = `search:${q}`

  // Check cache
  const cachedData = await cache.get(cacheKey)
  if (cachedData) {
    metrics.recordCache(true)
    return res.json(cachedData)
  }

  metrics.recordCache(false)

  try {
    const data = await upstreamService.search(q)

    // Bonus logic: Repeated queries get longer TTL
    let count = queryCounts.get(q) || 0
    count++
    queryCounts.set(q, count)

    let ttl = 86400 // 24h default
    if (count > 5) {
      ttl = 86400 * 3 // 3 days if queried many times
    }

    await cache.set(cacheKey, data, ttl)

    res.json(data)
  } catch (err) {
    logger.error('Upstream error in handleSearch', {
      context: 'Proxy',
      error: err.message,
      userAgent: err.config?.headers?.['User-Agent']
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
    res.status(502).json({ error: 'Failed to fetch from upstream API', details: diagnostic })
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

  const cacheKey = `artist:${term.toLowerCase().replace(/\s+/g, ' ')}`
  const cachedData = await cache.get(cacheKey)

  if (cachedData) {
    const providers = cachedData.providers?.length
      ? cachedData.providers
      : summarizeProvidersFromAlbums(cachedData.albums)

    metrics.recordCache(true)
    metrics.recordArtistLookup({
      term,
      upstreamCalls: 0,
      providers,
      partial: Boolean(cachedData.partial),
      statusCode: 200
    })
    res.set('X-Cache', 'HIT')
    res.set('X-Providers', providers.map(provider => provider.name).join(','))

    // We can conditionally strip debug if it was cached with debug, but we'll assume it's fine.
    const response = { ...cachedData, providers }
    if (!isDebug && response.debug) {
      delete response.debug
    }

    return res.json(response)
  }

  metrics.recordCache(false)

  try {
    const data = await aggregateArtist(term)

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

    const scores = rankedResults.map(r => r.score)
    const topConfidence = rankedResults[0]?.confidence || 0
    metrics.recordRanking(rankingTimeMs, scores, topConfidence)

    const topResult = rankedResults[0]

    // Enrichment Pipeline
    const enrichedTopResult = await enrichResult(topResult, isDebug)

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

    await cache.set(cacheKey, response, getConfigValue('cacheTtlSeconds'))

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

    // Also remove debug before responding if not requested, though it shouldn't be added if isDebug is false
    return res.json(response)
  } catch (error) {
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
  }
}

module.exports = { handleArtistLookup, handleSearch }

const axios = require('axios')
const cache = require('../cache')
const { getConfigValue } = require('../settings/store')
const { getProviderHttpsAgent } = require('../providers/http')
const logger = require('../utils/logger')
const metrics = require('../metrics')
const { enqueueProviderRequest } = require('../services/rate-limiter.service')

function getProviderAgent (provider) {
  const keyByProvider = {
    lastfm: 'lastfmIpFamily',
    discogs: 'discogsIpFamily'
  }
  return getProviderHttpsAgent(getConfigValue(keyByProvider[provider]) || getConfigValue('providerIpFamily'))
}

async function enrichArtistData (artistName) {
  const lastfmKey = getConfigValue('lastfmApiKey')
  const discogsToken = getConfigValue('discogsToken')
  const timeout = getConfigValue('upstreamTimeoutMs') || 10000

  const enrichment = {
    genres: [],
    tags: [],
    popularity: {
      listeners: 0,
      playcount: 0
    }
  }

  const promises = []

  if (lastfmKey) {
    promises.push(
      enqueueProviderRequest('lastfm', () => axios.get('https://ws.audioscrobbler.com/2.0/', {
        params: { method: 'artist.getinfo', artist: artistName, api_key: lastfmKey, format: 'json' },
        httpsAgent: getProviderAgent('lastfm'),
        timeout
      })).then(res => {
        const artist = res.data?.artist
        if (artist) {
          enrichment.popularity.listeners = parseInt(artist.stats?.listeners || 0, 10)
          enrichment.popularity.playcount = parseInt(artist.stats?.playcount || 0, 10)

          if (artist.tags && artist.tags.tag) {
            const tags = Array.isArray(artist.tags.tag) ? artist.tags.tag : [artist.tags.tag]
            enrichment.tags = tags.map(t => t.name).filter(Boolean)
            enrichment.genres = [...enrichment.tags] // Use tags as genres for Last.fm
          }
        }
      }).catch(err => {
        logger.warn('Last.fm enrichment failed', { artist: artistName, error: err.message })
      })
    )
  }

  if (discogsToken) {
    const appName = getConfigValue('appName') || 'Melodarr'
    const appVersion = getConfigValue('appVersion') || '1.0.0'
    const userAgent = `${appName}/${appVersion} +https://github.com`

    promises.push(
      enqueueProviderRequest('discogs', () => axios.get('https://api.discogs.com/database/search', {
        params: { type: 'artist', q: artistName },
        headers: {
          'User-Agent': userAgent,
          Authorization: `Discogs token=${discogsToken}`
        },
        httpsAgent: getProviderAgent('discogs'),
        timeout
      })).then(res => {
        const artists = res.data?.results || []
        const exactMatch = artists.find(a => a.title?.toLowerCase() === artistName.toLowerCase()) || artists[0]
        if (exactMatch && exactMatch.genre) {
          // Discogs provides genre array
          enrichment.genres = [...new Set([...enrichment.genres, ...exactMatch.genre])]
        }
      }).catch(err => {
        logger.warn('Discogs enrichment failed', { artist: artistName, error: err.message })
      })
    )
  }

  await Promise.allSettled(promises)
  return enrichment
}

async function enrichResult (topResult, isDebug = false) {
  if (!topResult || !topResult.artistName) {
    return topResult
  }

  const startTime = Date.now()
  const cacheKey = `enrichment:${topResult.artistName.toLowerCase().replace(/\s+/g, ' ')}`
  let enrichmentData = await cache.get(cacheKey)
  let isCached = true
  let success = true
  const enrichmentDebug = { cached: true, latencyMs: 0, error: null }

  if (!enrichmentData) {
    isCached = false
    try {
      enrichmentData = await enrichArtistData(topResult.artistName)
      // Cache for 24 hours
      await cache.set(cacheKey, enrichmentData, 86400)
      enrichmentDebug.cached = false
    } catch (err) {
      success = false
      logger.error('Enrichment pipeline failed', { error: err.message })
      enrichmentData = { tags: [], genres: [], popularity: { listeners: 0, playcount: 0 } }
      enrichmentDebug.error = err.message
      enrichmentDebug.cached = false
    }
  }

  const latency = Date.now() - startTime
  enrichmentDebug.latencyMs = latency

  metrics.recordEnrichment({
    success,
    cached: isCached,
    latencyMs: latency,
    hasTags: enrichmentData.tags?.length > 0,
    hasPopularity: enrichmentData.popularity?.listeners > 0
  })

  const result = {
    ...topResult,
    tags: enrichmentData.tags || [],
    genres: enrichmentData.genres || [],
    popularity: enrichmentData.popularity || { listeners: 0, playcount: 0 }
  }

  if (isDebug) {
    result._enrichmentDebug = enrichmentDebug
  }

  return result
}

module.exports = { enrichResult }

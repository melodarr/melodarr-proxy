const { getConfigValue } = require('../settings/store')
const metrics = require('../metrics')
const logger = require('../utils/logger')
const { getProviderScore } = require('./scoring')

const providers = {
  musicbrainz: require('./musicbrainz.provider'),
  lastfm: require('./lastfm.provider'),
  discogs: require('./discogs.provider'),
  theaudiodb: require('./theaudiodb.provider'),
  itunes: require('./itunes.provider')
}

function mergeIds (existingIds, nextIds) {
  return {
    ...(existingIds || {}),
    ...(nextIds || {})
  }
}

async function aggregateArtist (term) {
  const providerNamesStr = getConfigValue('metadataProviders') || 'musicbrainz'
  const providerNames = providerNamesStr.split(',').map(s => s.trim().toLowerCase())

  const activeProviders = providerNames
    .filter(name => providers[name])
    .map(name => providers[name])

  if (activeProviders.length === 0) {
    throw new Error('No active metadata providers configured')
  }

  const results = await Promise.allSettled(
    activeProviders.map(async provider => {
      const pStartTime = Date.now()
      try {
        const result = await provider.searchArtist(term)
        const duration = Date.now() - pStartTime

        // Record specific provider metrics
        if (metrics.recordProviderCall) {
          metrics.recordProviderCall(provider.name, true, duration)
        }

        return { provider: provider.name, result }
      } catch (error) {
        const duration = Date.now() - pStartTime
        logger.error(`Provider error [${provider.name}]`, {
          error: {
            message: error.message,
            code: error.code,
            stack: error.stack,
            responseData: error.response?.data,
            responseStatus: error.response?.status
          }
        })

        if (metrics.recordProviderCall) {
          metrics.recordProviderCall(provider.name, false, duration)
        }
        throw error
      }
    })
  )

  let mergedArtistName = term
  const albumMap = new Map() // key: normalized name -> merged album

  let successfulProviders = 0
  let partial = false
  const warningMessages = []
  const providerErrors = []

  const validOutcomes = []

  for (const outcome of results) {
    if (outcome.status === 'fulfilled') {
      successfulProviders++
      const data = outcome.value.result
      const provider = outcome.value.provider
      const score = getProviderScore(provider, data)

      validOutcomes.push({ provider, data, score })
    } else {
      partial = true
      const err = outcome.reason
      const message = err.message || 'Provider request failed'
      warningMessages.push(message)
      providerErrors.push(message)
    }
  }

  // Sort by score descending to prefer higher quality data
  validOutcomes.sort((a, b) => b.score - a.score)

  let overallConfidence = 0
  if (validOutcomes.length > 0) {
    overallConfidence = validOutcomes[0].score
  }

  for (const outcome of validOutcomes) {
    const { data, score, provider } = outcome

    // Use the first returned artist name we get if we don't have a good one yet
    // Since validOutcomes are sorted by score, the best provider gets to name the artist
    if (data.artistName && mergedArtistName === term) {
      mergedArtistName = data.artistName
    }

    for (const album of data.albums) {
      // Simple deduplication by normalized name
      const normName = album.name.toLowerCase().trim()
      const existing = albumMap.get(normName)

      if (existing) {
        existing.ids = mergeIds(existing.ids, album.ids)

        if (!existing.imageUrl && album.imageUrl) {
          existing.imageUrl = album.imageUrl
        }

        // If it exists, try to enrich with year if missing
        if (!existing.year && album.year) {
          existing.year = album.year
          existing.score = score
          existing.provider = provider
        } else if (existing.year && album.year && score > existing.score) {
          // If both have years, let the higher scored provider win
          existing.year = album.year
          existing.score = score
          existing.provider = provider
        }
      } else {
        albumMap.set(normName, {
          name: album.name,
          year: album.year,
          imageUrl: album.imageUrl || '',
          ids: mergeIds(null, album.ids),
          score,
          provider
        })
      }
    }
  }

  if (successfulProviders === 0) {
    throw new Error(`All metadata providers failed. Errors: ${warningMessages.join(' | ')}`)
  }

  return {
    artistName: mergedArtistName,
    albums: Array.from(albumMap.values()).map(a => ({
      name: a.name,
      year: a.year,
      imageUrl: a.imageUrl || '',
      ids: a.ids || {},
      provider: a.provider
    })),
    partial,
    warning: partial ? `Some providers failed: ${warningMessages.join(' | ')}` : null,
    providerCount: successfulProviders,
    providers: validOutcomes.map(outcome => ({
      name: outcome.provider,
      score: outcome.score,
      albumCount: outcome.data.albums?.length || 0
    })),
    providerErrors,
    confidence: overallConfidence
  }
}

module.exports = { aggregateArtist }

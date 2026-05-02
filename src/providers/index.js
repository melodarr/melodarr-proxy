const { getConfigValue } = require('../settings/store')
const metrics = require('../metrics')
const logger = require('../utils/logger')
const { getProviderScore } = require('./scoring')
const { safeProviderCall } = require('./safeProviderCall')
const providerMetrics = require('../health/providerMetrics')

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

  // v0.3.38: order the parallel fan-out by adaptive score so faster +
  // more-reliable providers get scheduled first. Order doesn't change
  // the parallel execution, but it documents intent and matches how the
  // merge step downstream walks validOutcomes.
  const orderedProviders = providerMetrics.sortByScore(activeProviders)

  const results = await Promise.allSettled(
    orderedProviders.map(async provider => {
      const pStartTime = Date.now()
      try {
        // v0.3.38: safeProviderCall layers circuit-breaker skip + shape
        // validation + provider-health/metrics recording around the raw
        // provider call. Returns null when the breaker is open; we
        // surface that as a sentinel error so existing partial-failure
        // detection (Promise.allSettled rejection counting) still works.
        const result = await safeProviderCall(provider.name, (q) => provider.searchArtist(q), term)
        if (result === null) {
          const skipErr = new Error(`Provider ${provider.name} skipped (circuit breaker open)`)
          skipErr.code = 'PROVIDER_DISABLED'
          throw skipErr
        }
        const duration = Date.now() - pStartTime

        // Existing dashboard metrics — kept alongside the new providerMetrics
        // (different consumer: stats endpoint vs. adaptive sorting).
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
  let id = ''
  let disambiguation = ''
  let overview = ''
  let images = []
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
    if (data.id && !id) {
      id = data.id
    }
    if (data.disambiguation && !disambiguation) {
      disambiguation = data.disambiguation
    }
    if (data.overview && !overview) {
      overview = data.overview
    }
    if (data.images && data.images.length > 0 && images.length === 0) {
      images = data.images
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
          existing.releaseDate = album.releaseDate || existing.releaseDate
          existing.score = score
          existing.provider = provider
        } else if (existing.year && album.year && score > existing.score) {
          // If both have years, let the higher scored provider win
          existing.year = album.year
          existing.releaseDate = album.releaseDate || existing.releaseDate
          existing.score = score
          existing.provider = provider
        } else if (album.releaseDate && (!existing.releaseDate || album.releaseDate.length > existing.releaseDate.length)) {
          // Same year, but the incoming provider has a more precise date
          // (e.g. iTunes "1997-05-21T07:00:00Z" beats MB "1997"). Take it
          // even when the score doesn't win — date precision is independent
          // of overall provider quality and Lidarr cares about full ISO.
          existing.releaseDate = album.releaseDate
        }
      } else {
        albumMap.set(normName, {
          name: album.name,
          year: album.year,
          releaseDate: album.releaseDate || null,
          imageUrl: album.imageUrl || '',
          ids: mergeIds(null, album.ids),
          score,
          provider
        })
      }
    }
  }

  // --- ARTIST IMAGE RESOLUTION FALLBACK CHAIN ---
  // If we don't have an explicitly provided artist image, we fall back sequentially:
  // 1. Cover Art Archive (from a self-titled album) if we have an MBID
  // 2. TheAudioDB profile image
  // 3. iTunes upscaled album artwork (from a self-titled album)
  if (images.length === 0) {
    let caaFallback = null
    let tadbFallback = null
    let itunesFallback = null

    const normalizedArtist = String(mergedArtistName || term).trim().toLowerCase()

    for (const outcome of validOutcomes) {
      const { data, provider } = outcome

      if (provider === 'musicbrainz' && data.id) {
        const albumWithImage = data.albums.find(a => {
          if (!a.imageUrl || !a.imageUrl.includes('coverartarchive.org')) return false
          return String(a.name || '').trim().toLowerCase() === normalizedArtist
        })
        if (albumWithImage) {
          caaFallback = { coverType: 'poster', url: albumWithImage.imageUrl, remoteUrl: albumWithImage.imageUrl, imageSource: 'coverartarchive' }
        }
      }

      if (provider === 'theaudiodb' && data.images && data.images.length > 0) {
        tadbFallback = { ...data.images[0], imageSource: 'audiodb' }
      }

      if (provider === 'itunes') {
        const albumWithImage = data.albums.find(a => {
          if (!a.imageUrl) return false
          return String(a.name || '').trim().toLowerCase() === normalizedArtist
        })
        if (albumWithImage) {
          itunesFallback = { coverType: 'poster', url: albumWithImage.imageUrl, remoteUrl: albumWithImage.imageUrl, imageSource: 'itunes' }
        }
      }
    }

    if (caaFallback) {
      images = [caaFallback]
    } else if (tadbFallback) {
      images = [tadbFallback]
    } else if (itunesFallback) {
      images = [itunesFallback]
    }
  }

  // Deduplicate images by URL
  const uniqueUrls = new Set()
  images = images.filter(img => {
    if (uniqueUrls.has(img.url)) return false
    uniqueUrls.add(img.url)
    return true
  })

  if (successfulProviders === 0) {
    throw new Error(`All metadata providers failed. Errors: ${warningMessages.join(' | ')}`)
  }

  return {
    artistName: mergedArtistName,
    id,
    disambiguation,
    overview,
    images,
    albums: Array.from(albumMap.values()).map(a => ({
      name: a.name,
      year: a.year,
      releaseDate: a.releaseDate || null,
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

async function testProvider (providerName, term) {
  const normalizedName = String(providerName || '').trim().toLowerCase()
  const provider = providers[normalizedName]

  if (!provider) {
    const validProviders = Object.keys(providers).join(', ')
    throw new Error(`Unknown provider "${providerName}". Valid providers: ${validProviders}`)
  }

  const startedAt = Date.now()
  const result = await provider.searchArtist(term)
  const durationMs = Date.now() - startedAt
  const albums = Array.isArray(result?.albums) ? result.albums : []

  return {
    provider: provider.name,
    query: term,
    durationMs,
    artistName: result?.artistName || term,
    albumCount: albums.length,
    sampleAlbums: albums.slice(0, 5).map(album => ({
      name: album.name || '',
      year: album.year || null
    }))
  }
}

module.exports = { aggregateArtist, testProvider }

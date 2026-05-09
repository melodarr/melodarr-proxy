const { getConfigValue } = require('../settings/store')
const metrics = require('../metrics')
const logger = require('../utils/logger')
const { getProviderScore } = require('./scoring')
const { safeProviderCall } = require('./safeProviderCall')
const providerMetrics = require('../health/providerMetrics')
const { normalizeAliases, normalizeStringArray } = require('../utils/lidarrArtist')

const customProviderModule = require('./custom.provider')

const builtinProviders = {
  musicbrainz: require('./musicbrainz.provider'),
  lastfm: require('./lastfm.provider'),
  discogs: require('./discogs.provider'),
  theaudiodb: require('./theaudiodb.provider'),
  itunes: require('./itunes.provider')
}

function getAllProviders () {
  const all = { ...builtinProviders }
  let customProviders = []
  try {
    customProviders = JSON.parse(getConfigValue('customProviders') || '[]')
  } catch (err) {
    logger.warn('Failed to parse customProviders config', { error: err.message })
  }
  for (const cp of customProviders) {
    if (cp && cp.id) {
      const id = String(cp.id).trim().toLowerCase()
      if (id) all[id] = customProviderModule.createCustomProvider({ ...cp, id })
    }
  }
  return all
}

function mergeIds (existingIds, nextIds) {
  return {
    ...(existingIds || {}),
    ...(nextIds || {})
  }
}

function normalizeProviderRating (value = {}) {
  const rating = value.rating || value.ratings || value
  return {
    count: Number(rating?.count ?? rating?.votes ?? 0) || 0,
    value: Number(rating?.value ?? 0) || 0
  }
}

function hasProviderRating (rating) {
  return Boolean(rating && (rating.count > 0 || rating.value > 0))
}

function shouldReplaceRating (existingRating, nextRating) {
  if (!hasProviderRating(nextRating)) {
    return false
  }

  if (!hasProviderRating(existingRating)) {
    return true
  }

  return nextRating.count > existingRating.count
}

async function aggregateArtist (term) {
  const providerNamesStr = getConfigValue('metadataProviders') || 'musicbrainz'
  const providerNames = providerNamesStr.split(',').map(s => s.trim().toLowerCase())

  const providerPriorityStr = getConfigValue('providerPriority') || ''
  const providerPriority = providerPriorityStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

  function getPriorityWeight (providerName) {
    if (providerPriority.length === 0) return 0
    const index = providerPriority.indexOf(providerName)
    if (index === -1) return 0
    return (providerPriority.length - index) * 1000000
  }

  const allProviders = getAllProviders()

  const activeProviders = providerNames
    .filter(name => allProviders[name])
    .map(name => allProviders[name])

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
        const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.message?.toLowerCase().includes('timeout') || error.message?.toLowerCase().includes('timed out')

        if (isTimeout) {
          logger.error(`Provider timeout [${provider.name}]`, { event: 'provider_timeout', provider: provider.name, duration })
        } else {
          logger.error(`Provider error [${provider.name}]`, {
            error: {
              message: error.message,
              code: error.code,
              stack: error.stack,
              responseData: error.response?.data,
              responseStatus: error.response?.status,
              isTimeout
            }
          })
        }

        if (metrics.recordProviderCall) {
          metrics.recordProviderCall(provider.name, false, duration, isTimeout)
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
  let oldIds = []
  let aliases = []
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
      const priorityWeight = getPriorityWeight(provider)

      validOutcomes.push({ provider, data, score, priorityWeight })
    } else {
      partial = true
      const err = outcome.reason
      const message = err.message || 'Provider request failed'
      warningMessages.push(message)
      providerErrors.push(message)
    }
  }

  // Sort by priority first, then by adaptive score descending
  validOutcomes.sort((a, b) => {
    if (a.priorityWeight !== b.priorityWeight) {
      return b.priorityWeight - a.priorityWeight
    }
    return b.score - a.score
  })

  let overallConfidence = 0
  if (validOutcomes.length > 0) {
    overallConfidence = validOutcomes[0].score
  }

  for (const outcome of validOutcomes) {
    const { data, score, priorityWeight, provider } = outcome

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
    const providerAliases = normalizeAliases(data)
    const providerOldIds = normalizeStringArray(data.oldIds || data.OldIds)
    if (providerOldIds.length > 0 && oldIds.length === 0) {
      oldIds = providerOldIds
    }
    if (providerAliases.length > 0 && aliases.length === 0) {
      aliases = providerAliases
    }
    for (const album of data.albums) {
      // Simple deduplication by normalized name
      const normName = album.name.toLowerCase().trim()
      const existing = albumMap.get(normName)

      if (existing) {
        existing.ids = mergeIds(existing.ids, album.ids)
        const nextRating = normalizeProviderRating(album)
        if (shouldReplaceRating(existing.rating, nextRating)) {
          existing.rating = nextRating
          existing.ratings = { votes: nextRating.count, value: nextRating.value }
        }

        if (!existing.imageUrl && album.imageUrl) {
          existing.imageUrl = album.imageUrl
        }

        // If it exists, try to enrich with year if missing
        if (!existing.year && album.year) {
          existing.year = album.year
          existing.releaseDate = album.releaseDate || existing.releaseDate
          existing.score = score
          existing.priorityWeight = priorityWeight
          existing.provider = provider
        } else if (existing.year && album.year && existing.year !== album.year) {
          logger.debug(`[Merge] Album year conflict for '${album.name}': keeping ${existing.year} (${existing.provider}) over ${album.year} (${provider})`)
        }

        if (album.releaseDate && (!existing.releaseDate || album.releaseDate.length > existing.releaseDate.length)) {
          // The incoming provider has a more precise date
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
          rating: normalizeProviderRating(album),
          ratings: {
            votes: normalizeProviderRating(album).count,
            value: normalizeProviderRating(album).value
          },
          ids: mergeIds(null, album.ids),
          score,
          priorityWeight,
          provider
        })
      }
    }
  }

  // --- IMAGE SCORING & SELECTION ---
  const imageCandidates = []
  const normalizedArtist = String(mergedArtistName || term).trim().toLowerCase()

  for (const outcome of validOutcomes) {
    const { data, provider } = outcome

    // 1. Artist profile images
    if (data.images && data.images.length > 0) {
      for (const img of data.images) {
        imageCandidates.push({
          url: img.url,
          coverType: img.coverType || 'poster',
          height: img.height,
          width: img.width,
          imageSource: provider,
          type: 'artist',
          isSelfTitled: false
        })
      }
    }

    // 2. Album covers (restricted to self-titled per guards)
    if (data.albums) {
      for (const album of data.albums) {
        if (!album.imageUrl) continue
        const isSelfTitled = String(album.name || '').trim().toLowerCase() === normalizedArtist
        if (!isSelfTitled) continue

        let imageSource = provider
        if (album.imageUrl.includes('coverartarchive.org')) {
          imageSource = 'coverartarchive'
        }

        imageCandidates.push({
          url: album.imageUrl,
          coverType: 'poster',
          imageSource,
          type: 'album',
          isSelfTitled
        })
      }
    }
  }

  const scoredImages = imageCandidates.map(candidate => {
    let score = 0
    // Type bonus
    if (candidate.type === 'artist') score += 1000
    else if (candidate.type === 'album') score += 10

    // Self-titled bonus
    if (candidate.type === 'album' && candidate.isSelfTitled) score += 50

    // Resolution bonus
    let width = 0
    let height = 0
    if (candidate.imageSource === 'audiodb') {
      width = 1000
      height = 1000
    } else if (candidate.imageSource === 'itunes') {
      width = 600
      height = 600
    } else if (candidate.imageSource === 'coverartarchive') {
      width = 500
      height = 500
    }

    const resolution = width * height
    if (resolution > 0) {
      score += Math.floor(Math.sqrt(resolution) / 10)
    }

    // Source weight
    if (candidate.imageSource === 'audiodb') score += 30
    else if (candidate.imageSource === 'coverartarchive') score += 20
    else if (candidate.imageSource === 'itunes') score += 10

    // HTTPS bonus
    if (candidate.url && candidate.url.startsWith('https://')) score += 5

    // Priority bonus
    const pw = getPriorityWeight(candidate.imageSource)
    if (pw > 0) {
      // Keep provider priority as a secondary signal so resolution, source, and HTTPS still matter.
      const priorityBonus = Math.min(25, Math.floor(pw / 1000000) * 5)
      score += priorityBonus
    }

    // Adaptive health multiplier
    const metricsData = providerMetrics.get(candidate.imageSource)
    const healthScore = providerMetrics.computeScore(metricsData) || 0.5
    score = Math.floor(score * healthScore)

    return { ...candidate, score }
  })

  // Deduplicate by URL and Sort desc
  const uniqueScored = []
  const seenUrls = new Set()
  for (const img of scoredImages) {
    if (!seenUrls.has(img.url)) {
      seenUrls.add(img.url)
      uniqueScored.push(img)
    }
  }
  uniqueScored.sort((a, b) => b.score - a.score)

  images = []
  if (uniqueScored.length > 0) {
    images = uniqueScored.slice(0, 6).map(image => ({
      coverType: image.coverType || 'poster',
      url: image.url,
      remoteUrl: image.url,
      imageSource: image.imageSource,
      height: Number(image.height ?? 0) || 0,
      width: Number(image.width ?? 0) || 0
    }))
  }

  const imageDebug = uniqueScored.slice(0, 5).map(img => ({ url: img.url, score: img.score, source: img.imageSource, type: img.type }))

  if (successfulProviders === 0) {
    throw new Error(`All metadata providers failed. Errors: ${warningMessages.join(' | ')}`)
  }

  const isFull = successfulProviders === orderedProviders.length
  const albumCount = Array.from(albumMap.values()).length
  const isEmpty = albumCount === 0

  if (isEmpty) {
    if (metrics.recordAggregation) metrics.recordAggregation('empty')
    logger.warn(`Aggregation empty result [${term}]`, { event: 'empty_result', term })
  } else if (isFull) {
    if (metrics.recordAggregation) metrics.recordAggregation('full')
  } else {
    if (metrics.recordAggregation) metrics.recordAggregation('partial')
    logger.warn(`Aggregation partial result [${term}]`, { event: 'partial_result', term, missing: orderedProviders.length - successfulProviders, warnings: warningMessages })
  }

  return {
    artistName: mergedArtistName,
    id,
    disambiguation,
    overview,
    oldIds,
    aliases,
    artistAliases: aliases,
    images,
    imageDebug,
    albums: Array.from(albumMap.values()).map(a => ({
      name: a.name,
      year: a.year,
      releaseDate: a.releaseDate || null,
      imageUrl: a.imageUrl || '',
      rating: a.rating || { count: 0, value: 0 },
      ratings: a.ratings || { votes: 0, value: 0 },
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
  const allProviders = getAllProviders()
  const provider = allProviders[normalizedName]

  if (!provider) {
    const validProviders = Object.keys(allProviders).join(', ')
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

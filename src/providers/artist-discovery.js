const upstreamService = require('../services/upstream.service')
const axios = require('axios')
const { httpsAgent } = require('./http')
const { getConfigValue } = require('../settings/store')
const logger = require('../utils/logger')
const theaudiodbProvider = require('./theaudiodb.provider')
const discogsProvider = require('./discogs.provider')
const { safeProviderCall } = require('./safeProviderCall')
const metrics = require('../metrics')
const { normalizeStringArray } = require('../utils/lidarrArtist')

const FALLBACK_ORDER = ['musicbrainz', 'itunes', 'theaudiodb', 'discogs']

function normalizeText (value) {
  return String(value || '').trim()
}

function normalizeKey (value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function uniqueCandidates (candidates) {
  const seen = new Set()
  const results = []

  for (const candidate of candidates) {
    const key = `${candidate.artistName}`.toLowerCase()
    if (!candidate.artistName || seen.has(key)) continue
    seen.add(key)
    results.push(candidate)
  }

  return results
}

function mergeSongAlbums (preferredAlbums, fallbackAlbums) {
  const seen = new Set()
  const albums = []

  for (const album of [...preferredAlbums, ...fallbackAlbums]) {
    const key = normalizeKey(album.albumName)
    if (!key || seen.has(key)) continue
    seen.add(key)
    albums.push(album)
  }

  return albums
}

function hasImages (candidate) {
  return Boolean(candidate?.imageUrl) || (Array.isArray(candidate?.images) && candidate.images.length > 0)
}

function extractMusicBrainzAliases (artist = {}) {
  return normalizeStringArray((artist.aliases || []).map(alias => alias?.name || alias?.['sort-name']))
}

function mergeCandidateImages (candidates, imageCandidates) {
  if (!Array.isArray(candidates) || !Array.isArray(imageCandidates) || imageCandidates.length === 0) {
    return candidates
  }

  const imageByArtist = new Map()
  for (const candidate of imageCandidates) {
    const key = normalizeKey(candidate.artistName)
    if (key && hasImages(candidate)) {
      imageByArtist.set(key, candidate)
    }
  }

  if (imageByArtist.size === 0) {
    return candidates
  }

  return candidates.map(candidate => {
    if (hasImages(candidate)) return candidate
    const imageCandidate = imageByArtist.get(normalizeKey(candidate.artistName))
    if (!imageCandidate) return candidate

    return {
      ...candidate,
      imageUrl: imageCandidate.imageUrl || imageCandidate.images?.[0]?.url || '',
      images: imageCandidate.images || [],
      overview: candidate.overview || imageCandidate.overview || '',
      ids: {
        ...(candidate.ids || {}),
        ...(imageCandidate.ids || {})
      }
    }
  })
}

function scoreExact (value, query, exactScore, fallbackScore) {
  return normalizeText(value).toLowerCase() === normalizeText(query).toLowerCase() ? exactScore : fallbackScore
}

// Reads METADATA_PROVIDERS / runtime override and returns a Set of enabled
// provider names. The discover routes used to hard-call MusicBrainz; now they
// honor this set so MB-disabled deployments stop 502ing on TLS resets.
function getEnabledProviders () {
  const raw = getConfigValue('metadataProviders') || 'musicbrainz'
  return new Set(
    String(raw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  )
}

// Try providers in FALLBACK_ORDER. First non-empty success wins. On failure
// the next provider is attempted; if all enabled providers fail the caller
// gets `[]` rather than a thrown error — the controller decides how to surface
// the partial state to the client.
//
// v0.3.38: every call goes through safeProviderCall, so circuit-breaker
// state and provider metrics are kept up to date here too. The fallback
// ORDER is preserved (per finalized rule 6 — operator-configured priority,
// not adaptive score), but disabled providers are skipped automatically.
async function tryProvidersInOrder (kind, query, attempts) {
  const enabled = getEnabledProviders()
  const errors = []

  for (const name of FALLBACK_ORDER) {
    if (!enabled.has(name)) continue
    const fn = attempts[name]
    if (!fn) continue
    try {
      const result = await safeProviderCall(name, fn, query)
      // null = circuit breaker open → skip silently and try next provider.
      if (result === null) {
        metrics.recordProviderFallback(false)
        continue
      }
      if (Array.isArray(result) && result.length > 0) {
        if (kind !== 'artist' || name !== 'musicbrainz' || result.some(hasImages)) {
          return result
        }

        return enrichArtistImages(result, query, enabled, attempts, name)
      } else {
        // Result is an empty array -> fallback to next provider
        metrics.recordProviderFallback(false)
      }
    } catch (err) {
      metrics.recordProviderFallback(false)
      errors.push({ provider: name, message: err.message, code: err.code })
      logger.warn('Discovery provider failed', {
        kind,
        query,
        provider: name,
        error: err.message,
        code: err.code
      })
    }
  }

  if (errors.length > 0) {
    metrics.recordProviderFallback(true) // Exhaustion
    logger.warn('All discovery providers exhausted', { kind, query, errors })
  }
  return []
}

async function enrichArtistImages (candidates, query, enabled, attempts, primaryProvider) {
  let enriched = candidates
  for (const name of ['theaudiodb', 'discogs', 'itunes']) {
    if (name === primaryProvider || !enabled.has(name) || !attempts[name] || enriched.every(hasImages)) {
      continue
    }

    try {
      const imageCandidates = await attempts[name]()
      enriched = mergeCandidateImages(enriched, imageCandidates)
    } catch (err) {
      logger.warn('Artist image enrichment provider failed', {
        query,
        provider: name,
        error: err.message,
        code: err.code
      })
    }
  }

  return enriched
}

async function discoverArtistByMb (query) {
  const result = await upstreamService.musicBrainzGet('/artist', {
    query: `artist:"${String(query).replace(/"/g, '\\"')}"`,
    inc: 'aliases',
    limit: 10
  })

  return (result?.artists || []).map((artist) => ({
    artistName: artist.name || artist['sort-name'] || '',
    id: artist.id || '',
    type: 'artist',
    source: 'musicbrainz',
    match: artist.name || '',
    disambiguation: artist.disambiguation || '',
    oldIds: [],
    aliases: extractMusicBrainzAliases(artist),
    artistAliases: extractMusicBrainzAliases(artist),
    score: Number(artist.score || scoreExact(artist.name, query, 100, 70)),
    ids: {
      musicbrainzArtistId: artist.id || ''
    }
  }))
}

async function discoverSongByMb (query) {
  const result = await upstreamService.musicBrainzGet('/recording', {
    query: `recording:"${String(query).replace(/"/g, '\\"')}"`,
    limit: 25
  })

  const candidates = []
  for (const recording of result?.recordings || []) {
    for (const credit of recording['artist-credit'] || []) {
      const artist = credit.artist
      if (!artist) continue
      candidates.push({
        artistName: artist.name || '',
        type: 'song',
        source: 'musicbrainz',
        match: recording.title || query,
        disambiguation: artist.disambiguation || '',
        score: Number(recording.score || scoreExact(recording.title, query, 100, 65)),
        ids: {
          musicbrainzArtistId: artist.id || '',
          musicbrainzRecordingId: recording.id || ''
        }
      })
    }
  }

  return uniqueCandidates(candidates)
}

async function discoverAlbumByMb (query) {
  const result = await upstreamService.musicBrainzGet('/release-group', {
    query: `releasegroup:"${String(query).replace(/"/g, '\\"')}"`,
    limit: 25
  })

  const candidates = []
  for (const group of result?.['release-groups'] || []) {
    for (const credit of group['artist-credit'] || []) {
      const artist = credit.artist
      if (!artist) continue
      candidates.push({
        artistName: artist.name || '',
        type: 'album',
        source: 'musicbrainz',
        match: group.title || query,
        disambiguation: artist.disambiguation || '',
        score: Number(group.score || scoreExact(group.title, query, 100, 65)),
        ids: {
          musicbrainzArtistId: artist.id || '',
          musicbrainzReleaseGroupId: group.id || ''
        }
      })
    }
  }

  return uniqueCandidates(candidates)
}

async function discoverByITunes (query, type) {
  const entityByType = { artist: 'musicArtist', album: 'album', song: 'song' }
  const entity = entityByType[type] || 'musicArtist'

  const response = await axios.get('https://itunes.apple.com/search', {
    params: {
      term: query,
      media: 'music',
      entity,
      limit: 25,
      country: getConfigValue('itunesCountry') || 'US'
    },
    httpsAgent,
    timeout: getConfigValue('upstreamTimeoutMs') || 10000
  })

  const results = response.data?.results || []
  return uniqueCandidates(results.map((item) => {
    const matchField = type === 'album' ? item.collectionName : type === 'song' ? item.trackName : item.artistName
    return {
      artistName: item.artistName || '',
      type: type || 'artist',
      source: 'itunes',
      match: matchField || item.artistName || '',
      imageUrl: item.artworkUrl100 || '',
      score: scoreExact(matchField || item.artistName, query, 95, 60),
      ids: {
        itunesArtistId: item.artistId ? String(item.artistId) : '',
        itunesCollectionId: item.collectionId ? String(item.collectionId) : '',
        itunesTrackId: item.trackId ? String(item.trackId) : ''
      }
    }
  }))
}

// Lightweight artist-only adapter over theaudiodb.searchArtist. We only need
// the artist-name candidate for discover; the album payload is discarded.
async function discoverArtistByTheAudioDb (query) {
  const data = typeof theaudiodbProvider.searchArtistProfile === 'function'
    ? await theaudiodbProvider.searchArtistProfile(query)
    : await theaudiodbProvider.searchArtist(query)
  if (!data?.artistName) return []
  return [{
    artistName: data.artistName,
    type: 'artist',
    source: 'theaudiodb',
    match: data.artistName,
    overview: data.overview || '',
    images: data.images || [],
    imageUrl: data.imageUrl || data.images?.[0]?.url || '',
    score: scoreExact(data.artistName, query, 90, 55),
    ids: data.ids || {}
  }]
}

async function discoverArtistByDiscogs (query) {
  const data = await discogsProvider.searchArtist(query)
  if (!data?.artistName) return []
  return [{
    artistName: data.artistName,
    type: 'artist',
    source: 'discogs',
    match: data.artistName,
    images: data.images || [],
    imageUrl: data.imageUrl || data.images?.[0]?.url || '',
    score: scoreExact(data.artistName, query, 90, 55),
    ids: {}
  }]
}

async function findSongAlbumsByITunes (artist, song) {
  const response = await axios.get('https://itunes.apple.com/search', {
    params: {
      term: `${artist} ${song}`,
      media: 'music',
      entity: 'song',
      limit: 50,
      country: getConfigValue('itunesCountry') || 'US'
    },
    httpsAgent,
    timeout: getConfigValue('upstreamTimeoutMs') || 10000
  })

  const normalizedArtist = normalizeText(artist).toLowerCase()
  const normalizedSong = normalizeText(song).toLowerCase()
  const seen = new Set()

  return (response.data?.results || [])
    .filter((item) => {
      return normalizeText(item.artistName).toLowerCase() === normalizedArtist &&
        normalizeText(item.trackName).toLowerCase().includes(normalizedSong) &&
        item.collectionName
    })
    .filter((item) => {
      const key = String(item.collectionId || item.collectionName).toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((item) => ({
      albumName: item.collectionName || '',
      artistName: item.artistName || artist,
      songName: item.trackName || song,
      year: item.releaseDate ? Number.parseInt(String(item.releaseDate).slice(0, 4), 10) || null : null,
      imageUrl: item.artworkUrl100 || '',
      source: 'itunes',
      ids: {
        itunesArtistId: item.artistId ? String(item.artistId) : '',
        itunesCollectionId: item.collectionId ? String(item.collectionId) : '',
        itunesTrackId: item.trackId ? String(item.trackId) : ''
      }
    }))
}

async function findSongAlbumsByMusicBrainz (artist, song) {
  const result = await upstreamService.musicBrainzGet('/recording', {
    query: `artist:"${String(artist).replace(/"/g, '\\"')}" AND recording:"${String(song).replace(/"/g, '\\"')}"`,
    inc: 'releases+artist-credits',
    limit: 25
  })

  const seen = new Set()
  const albums = []

  for (const recording of result?.recordings || []) {
    for (const release of recording.releases || []) {
      const key = release.id || release.title
      if (!release.title || seen.has(key)) continue
      seen.add(key)
      albums.push({
        albumName: release.title,
        artistName: artist,
        songName: recording.title || song,
        year: release.date ? Number.parseInt(String(release.date).slice(0, 4), 10) || null : null,
        imageUrl: release.id ? `https://coverartarchive.org/release/${release.id}/front-250` : '',
        source: 'musicbrainz',
        ids: {
          musicbrainzRecordingId: recording.id || '',
          musicbrainzReleaseId: release.id || ''
        }
      })
    }
  }

  return albums
}

async function findSongAlbums ({ artist, song }) {
  const normalizedArtist = normalizeText(artist)
  const normalizedSong = normalizeText(song)

  if (!normalizedArtist || !normalizedSong) {
    throw new Error('Artist and song are required')
  }

  const enabled = getEnabledProviders()
  const tasks = []
  const labels = []

  if (enabled.has('musicbrainz')) {
    labels.push('musicbrainz')
    tasks.push(findSongAlbumsByMusicBrainz(normalizedArtist, normalizedSong))
  }
  if (enabled.has('itunes')) {
    labels.push('itunes')
    tasks.push(findSongAlbumsByITunes(normalizedArtist, normalizedSong))
  }

  if (tasks.length === 0) {
    return { artist: normalizedArtist, song: normalizedSong, source: 'none', albums: [] }
  }

  const settled = await Promise.allSettled(tasks)
  const byProvider = {}
  settled.forEach((outcome, i) => {
    byProvider[labels[i]] = outcome
  })

  const mbAlbums = byProvider.musicbrainz?.status === 'fulfilled' ? byProvider.musicbrainz.value : []
  const itunesAlbums = byProvider.itunes?.status === 'fulfilled' ? byProvider.itunes.value : []
  const albums = mergeSongAlbums(itunesAlbums, mbAlbums)

  const allRejected = settled.every(s => s.status === 'rejected')
  if (albums.length === 0 && allRejected) {
    metrics.recordProviderFallback(true) // Exhaustion
    return {
      artist: normalizedArtist,
      song: normalizedSong,
      source: 'none',
      albums: [],
      partial: true,
      warning: 'All configured providers failed'
    }
  }

  let source = 'combined'
  if (mbAlbums.length === 0 && itunesAlbums.length > 0) source = 'itunes'
  else if (itunesAlbums.length === 0 && mbAlbums.length > 0) source = 'musicbrainz'

  return {
    artist: normalizedArtist,
    song: normalizedSong,
    source,
    albums
  }
}

async function discoverArtists ({ query, type }) {
  const normalizedQuery = normalizeText(query)
  const normalizedType = normalizeText(type || 'artist').toLowerCase()

  if (!normalizedQuery) {
    throw new Error('Query is required')
  }

  if (normalizedType === 'song') {
    return tryProvidersInOrder('song', normalizedQuery, {
      musicbrainz: () => discoverSongByMb(normalizedQuery),
      itunes: () => discoverByITunes(normalizedQuery, 'song')
    })
  }

  if (normalizedType === 'album') {
    return tryProvidersInOrder('album', normalizedQuery, {
      musicbrainz: () => discoverAlbumByMb(normalizedQuery),
      itunes: () => discoverByITunes(normalizedQuery, 'album')
    })
  }

  return tryProvidersInOrder('artist', normalizedQuery, {
    musicbrainz: () => discoverArtistByMb(normalizedQuery),
    itunes: () => discoverByITunes(normalizedQuery, 'artist'),
    theaudiodb: () => discoverArtistByTheAudioDb(normalizedQuery),
    discogs: () => discoverArtistByDiscogs(normalizedQuery)
  })
}

module.exports = {
  discoverArtists,
  findSongAlbums,
  getEnabledProviders
}

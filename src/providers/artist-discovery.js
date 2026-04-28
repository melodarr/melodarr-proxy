const upstreamService = require('../services/upstream.service')
const axios = require('axios')
const { httpsAgent } = require('./http')
const { getConfigValue } = require('../settings/store')

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

function scoreExact (value, query, exactScore, fallbackScore) {
  return normalizeText(value).toLowerCase() === normalizeText(query).toLowerCase() ? exactScore : fallbackScore
}

async function discoverByArtist (query) {
  const result = await upstreamService.musicBrainzGet('/artist', {
    query: `artist:"${String(query).replace(/"/g, '\\"')}"`,
    limit: 10
  })

  return (result?.artists || []).map((artist) => ({
    artistName: artist.name || artist['sort-name'] || '',
    type: 'artist',
    source: 'musicbrainz',
    match: artist.name || '',
    disambiguation: artist.disambiguation || '',
    score: Number(artist.score || scoreExact(artist.name, query, 100, 70)),
    ids: {
      musicbrainzArtistId: artist.id || ''
    }
  }))
}

async function discoverBySong (query) {
  try {
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
  } catch (error) {
    return discoverByITunes(query, 'song')
  }
}

async function discoverByAlbum (query) {
  try {
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
  } catch (error) {
    return discoverByITunes(query, 'album')
  }
}

async function discoverByITunes (query, type) {
  const response = await axios.get('https://itunes.apple.com/search', {
    params: {
      term: query,
      media: 'music',
      entity: type === 'album' ? 'album' : 'song',
      limit: 25,
      country: getConfigValue('itunesCountry') || 'US'
    },
    httpsAgent,
    timeout: getConfigValue('upstreamTimeoutMs') || 10000
  })

  const results = response.data?.results || []
  return uniqueCandidates(results.map((item) => ({
    artistName: item.artistName || '',
    type,
    source: 'itunes',
    match: type === 'album' ? item.collectionName : item.trackName,
    score: scoreExact(type === 'album' ? item.collectionName : item.trackName, query, 95, 60),
    ids: {
      itunesArtistId: item.artistId ? String(item.artistId) : '',
      itunesCollectionId: item.collectionId ? String(item.collectionId) : '',
      itunesTrackId: item.trackId ? String(item.trackId) : ''
    }
  })))
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

  const [musicBrainzResult, itunesResult] = await Promise.allSettled([
    findSongAlbumsByMusicBrainz(normalizedArtist, normalizedSong),
    findSongAlbumsByITunes(normalizedArtist, normalizedSong)
  ])

  const musicBrainzAlbums = musicBrainzResult.status === 'fulfilled' ? musicBrainzResult.value : []
  const itunesAlbums = itunesResult.status === 'fulfilled' ? itunesResult.value : []
  const albums = mergeSongAlbums(itunesAlbums, musicBrainzAlbums)

  if (albums.length === 0 && musicBrainzResult.status === 'rejected' && itunesResult.status === 'rejected') {
    throw musicBrainzResult.reason || itunesResult.reason
  }

  return {
    artist: normalizedArtist,
    song: normalizedSong,
    source: itunesAlbums.length > 0 && musicBrainzAlbums.length > 0
      ? 'combined'
      : itunesAlbums.length > 0 ? 'itunes' : 'musicbrainz',
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
    return discoverBySong(normalizedQuery)
  }

  if (normalizedType === 'album') {
    return discoverByAlbum(normalizedQuery)
  }

  return discoverByArtist(normalizedQuery)
}

module.exports = {
  discoverArtists,
  findSongAlbums
}

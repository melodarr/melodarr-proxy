const upstreamService = require('../services/upstream.service')

class MusicBrainzProvider {
  constructor () {
    this.name = 'musicbrainz'
  }

  mbQueryValue (value) {
    return String(value || '').replace(/"/g, '\\"')
  }

  selectBestArtist (searchResult, term) {
    const artists = searchResult?.artists || []
    if (artists.length === 0) return null

    const normalizedTerm = String(term).trim().toLowerCase()
    const exactMatch = artists.find((artist) => {
      const name = String(artist.name || '').toLowerCase()
      const sortName = String(artist['sort-name'] || '').toLowerCase()
      return name === normalizedTerm || sortName === normalizedTerm
    })

    return exactMatch || artists[0]
  }

  extractAliases (artist = {}) {
    return (artist.aliases || [])
      .map(alias => String(alias?.name || alias?.['sort-name'] || '').trim())
      .filter(Boolean)
  }

  mapRating (value = {}) {
    const rating = value.rating || value
    return {
      count: Number(rating?.['votes-count'] ?? rating?.votes ?? rating?.count ?? 0) || 0,
      value: Number(rating?.value ?? 0) || 0
    }
  }

  mapArtistCreditArtists (artistCredits = []) {
    return (Array.isArray(artistCredits) ? artistCredits : [])
      .map(credit => credit?.artist)
      .filter(artist => artist?.id)
      .map(artist => ({
        id: artist.id,
        foreignArtistId: artist.id,
        artistName: artist.name || artist['sort-name'] || '',
        aliases: [],
        artistAliases: []
      }))
  }

  mergeArtists (...artistGroups) {
    const artists = []
    const seen = new Set()

    for (const group of artistGroups) {
      for (const artist of group || []) {
        if (!artist?.id || seen.has(artist.id)) {
          continue
        }

        seen.add(artist.id)
        artists.push(artist)
      }
    }

    return artists
  }

  collectReleaseArtists (releaseResult = {}) {
    const releases = Array.isArray(releaseResult.releases) ? releaseResult.releases : []
    const artists = []

    for (const release of releases) {
      artists.push(...this.mapArtistCreditArtists(release['artist-credit']))

      for (const medium of Array.isArray(release.media) ? release.media : []) {
        for (const track of Array.isArray(medium.tracks) ? medium.tracks : []) {
          artists.push(...this.mapArtistCreditArtists(track['artist-credit']))
          artists.push(...this.mapArtistCreditArtists(track.recording?.['artist-credit']))
        }
      }
    }

    return this.mergeArtists(artists)
  }

  mapReleaseTracks (media = [], fallbackArtistId = '') {
    const tracks = []

    for (const medium of media) {
      const mediumNumber = Number(medium.position || 1) || 1
      const mediumTracks = Array.isArray(medium.tracks) ? medium.tracks : []

      mediumTracks.forEach((track, index) => {
        const recording = track.recording || {}
        const artistCredit = Array.isArray(recording['artist-credit'])
          ? recording['artist-credit'].find(credit => credit?.artist)?.artist
          : null
        const artistId = artistCredit?.id || fallbackArtistId
        const title = track.title || recording.title || ''

        if (!title) {
          return
        }

        tracks.push({
          artistId,
          durationMs: Number(track.length || recording.length || 0) || 0,
          id: track.id || recording.id || `${mediumNumber}-${index + 1}`,
          oldIds: [],
          recordingId: recording.id || track.recording?.id || '',
          oldRecordingIds: [],
          trackName: title,
          trackNumber: String(track.number || index + 1),
          trackPosition: Number(track.position || index + 1) || index + 1,
          explicit: false,
          mediumNumber
        })
      })
    }

    return tracks
  }

  mapReleases (releaseResult = {}, fallbackArtistId = '') {
    const releases = Array.isArray(releaseResult.releases) ? releaseResult.releases : []

    return releases
      .map((release) => {
        const media = Array.isArray(release.media) ? release.media : []
        const tracks = this.mapReleaseTracks(media, fallbackArtistId)

        return {
          id: release.id || '',
          oldIds: [],
          title: release.title || '',
          status: release.status || 'Official',
          label: [],
          disambiguation: release.disambiguation || '',
          country: release.country ? [release.country] : [],
          releaseDate: release.date || null,
          media: media.map((medium, index) => ({
            name: medium.title || medium.format || 'Unknown',
            format: medium.format || 'Unknown',
            position: Number(medium.position || index + 1) || index + 1
          })),
          trackCount: tracks.length,
          tracks
        }
      })
      .filter(release => release.id && release.tracks.length > 0)
  }

  async searchArtist (term) {
    const artistSearch = await upstreamService.musicBrainzGet('/artist', {
      query: `artist:"${this.mbQueryValue(term)}"`,
      limit: 5
    })
    const artist = this.selectBestArtist(artistSearch, term)

    if (!artist) {
      return { artistName: term, albums: [] }
    }

    const releaseGroupResult = await upstreamService.musicBrainzGet('/release-group', {
      artist: artist.id,
      inc: 'releases+ratings',
      type: 'album|ep',
      limit: 100,
      offset: 0
    })
    const releaseGroups = releaseGroupResult?.['release-groups'] || []

    const albums = releaseGroups
      .filter((group) => {
        const primaryType = String(group['primary-type'] || '').toLowerCase()
        const secondaryTypes = group['secondary-types'] || []
        return ['album', 'ep'].includes(primaryType) && secondaryTypes.length === 0
      })
      .map(group => {
        const rawDate = group['first-release-date'] || ''
        const yearMatch = rawDate.match(/^(\d{4})/)
        const rating = this.mapRating(group)

        const rawReleases = Array.isArray(group.releases) ? group.releases : []
        const releases = rawReleases.map(r => ({
          id: r.id || '',
          title: r.title || group.title || '',
          status: r.status || 'Official',
          disambiguation: r.disambiguation || '',
          country: r.country ? [r.country] : [],
          releaseDate: r.date || null,
          trackCount: Number(r['track-count'] || 0),
          media: [],
          tracks: []
        }))
        const trackCounts = releases.map(r => Number(r.trackCount) || 0)
        const trackCount = trackCounts.length ? Math.max(...trackCounts) : 0

        return {
          name: group.title || '',
          year: yearMatch ? parseInt(yearMatch[1], 10) : null,
          // MB returns YYYY, YYYY-MM, or YYYY-MM-DD. Preserve as-is; downstream
          // consumers can pad to full ISO for Lidarr compatibility.
          releaseDate: rawDate || null,
          trackCount,
          type: group['primary-type'] || 'Album',
          albumType: group['primary-type'] || 'Album',
          secondaryTypes: group['secondary-types'] || [],
          releaseStatuses: ['Official'],
          imageUrl: group.id ? `https://coverartarchive.org/release-group/${group.id}/front-250` : '',
          rating,
          ratings: { votes: rating.count, value: rating.value },
          ids: {
            musicbrainzReleaseGroupId: group.id || ''
          },
          releases
        }
      }).filter(a => a.name)

    return {
      schemaVersion: 'skyhook-v1',
      artistName: artist.name || artist['sort-name'] || '',
      id: artist.id || '',
      disambiguation: artist.disambiguation || '',
      overview: artist.disambiguation || '',
      oldIds: [],
      aliases: this.extractAliases(artist),
      artistAliases: this.extractAliases(artist),
      images: [],
      albums
    }
  }

  async lookupArtistById (artistId) {
    const artist = await upstreamService.musicBrainzGet(`/artist/${encodeURIComponent(artistId)}`, {
      inc: 'aliases'
    })

    if (!artist?.id) {
      const err = new Error('MusicBrainz artist not found')
      err.code = 'ARTIST_NOT_FOUND'
      throw err
    }

    const releaseGroupResult = await upstreamService.musicBrainzGet('/release-group', {
      artist: artist.id,
      inc: 'releases+ratings',
      type: 'album|ep',
      limit: 100,
      offset: 0
    })
    const releaseGroups = releaseGroupResult?.['release-groups'] || []

    const albums = releaseGroups
      .filter((group) => {
        const primaryType = String(group['primary-type'] || '').toLowerCase()
        const secondaryTypes = group['secondary-types'] || []
        return ['album', 'ep'].includes(primaryType) && secondaryTypes.length === 0
      })
      .map(group => {
        const rawDate = group['first-release-date'] || ''
        const yearMatch = rawDate.match(/^(\d{4})/)
        const rating = this.mapRating(group)

        const rawReleases = Array.isArray(group.releases) ? group.releases : []
        const releases = rawReleases.map(r => ({
          id: r.id || '',
          title: r.title || group.title || '',
          status: r.status || 'Official',
          disambiguation: r.disambiguation || '',
          country: r.country ? [r.country] : [],
          releaseDate: r.date || null,
          trackCount: Number(r['track-count'] || 0),
          media: [],
          tracks: []
        }))
        const trackCounts = releases.map(r => Number(r.trackCount) || 0)
        const trackCount = trackCounts.length ? Math.max(...trackCounts) : 0

        return {
          name: group.title || '',
          year: yearMatch ? parseInt(yearMatch[1], 10) : null,
          releaseDate: rawDate || null,
          trackCount,
          type: group['primary-type'] || 'Album',
          albumType: group['primary-type'] || 'Album',
          secondaryTypes: group['secondary-types'] || [],
          releaseStatuses: ['Official'],
          imageUrl: group.id ? `https://coverartarchive.org/release-group/${group.id}/front-250` : '',
          rating,
          ratings: { votes: rating.count, value: rating.value },
          ids: {
            musicbrainzReleaseGroupId: group.id || ''
          },
          provider: 'musicbrainz',
          releases
        }
      }).filter(a => a.name)

    return {
      schemaVersion: 'skyhook-v1',
      artistName: artist.name || artist['sort-name'] || '',
      id: artist.id || '',
      disambiguation: artist.disambiguation || '',
      overview: artist.disambiguation || '',
      oldIds: [],
      aliases: this.extractAliases(artist),
      artistAliases: this.extractAliases(artist),
      images: [],
      albums,
      partial: false,
      warning: null,
      providerCount: 1,
      providers: [{ name: 'musicbrainz', score: 100, albumCount: albums.length }],
      providerErrors: [],
      confidence: 100
    }
  }

  async lookupAlbumById (releaseGroupId) {
    const group = await upstreamService.musicBrainzGet(`/release-group/${encodeURIComponent(releaseGroupId)}`, {
      inc: 'artist-credits+ratings'
    })

    if (!group?.id) {
      const err = new Error('MusicBrainz release group not found')
      err.code = 'ALBUM_NOT_FOUND'
      throw err
    }

    const groupArtists = this.mapArtistCreditArtists(group['artist-credit'])
    const rawDate = group['first-release-date'] || ''
    const releaseResult = await upstreamService.musicBrainzGet('/release', {
      'release-group': group.id || releaseGroupId,
      inc: 'media+recordings+artist-credits',
      limit: 10,
      offset: 0
    })
    const releaseArtists = this.collectReleaseArtists(releaseResult)
    const artists = this.mergeArtists(groupArtists, releaseArtists)
    const primaryArtist = groupArtists[0] || releaseArtists[0] || null
    const artistId = primaryArtist?.id || ''
    const artistName = primaryArtist?.artistName || ''
    const releases = this.mapReleases(releaseResult, artistId)
    const rating = this.mapRating(group)

    return {
      id: group.id || releaseGroupId,
      title: group.title || '',
      name: group.title || '',
      artistId,
      artist: {
        id: artistId,
        foreignArtistId: artistId,
        artistName,
        aliases: [],
        artistAliases: []
      },
      artists,
      releaseDate: rawDate || null,
      imageUrl: group.id ? `https://coverartarchive.org/release-group/${group.id}/front-250` : '',
      rating,
      ratings: { votes: rating.count, value: rating.value },
      images: group.id
        ? [{
            coverType: 'cover',
            url: `https://coverartarchive.org/release-group/${group.id}/front-250`,
            remoteUrl: `https://coverartarchive.org/release-group/${group.id}/front-250`
          }]
        : [],
      ids: {
        musicbrainzReleaseGroupId: group.id || releaseGroupId
      },
      provider: 'musicbrainz',
      type: group['primary-type'] || 'Album',
      albumType: group['primary-type'] || 'Album',
      secondaryTypes: group['secondary-types'] || [],
      releaseStatuses: ['Official'],
      releases
    }
  }
}

module.exports = new MusicBrainzProvider()

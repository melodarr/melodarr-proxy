const upstreamService = require('../services/upstream.service')

const MUSICBRAINZ_RELEASE_GROUP_PAGE_SIZE = 100
const MUSICBRAINZ_RELEASE_GROUP_PAGE_LIMIT = 10
const MUSICBRAINZ_RELEASE_PAGE_SIZE = 100
const MUSICBRAINZ_RELEASE_PAGE_LIMIT = 10
const MUSICBRAINZ_ARTIST_SEARCH_LIMIT = 100

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
    const exactMatches = artists.filter((artist) => {
      const name = String(artist.name || '').toLowerCase()
      const sortName = String(artist['sort-name'] || '').toLowerCase()
      return name === normalizedTerm || sortName === normalizedTerm
    })

    if (exactMatches.length > 0) {
      return exactMatches.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))[0]
    }

    return artists[0]
  }

  extractAliases (artist = {}) {
    return (artist.aliases || [])
      .map(alias => String(alias?.name || alias?.['sort-name'] || '').trim())
      .filter(Boolean)
  }

  extractRelations (artist = {}) {
    return Array.isArray(artist.relations) ? artist.relations : []
  }

  extractLinks (artist = {}) {
    return this.extractRelations(artist)
      .map(relation => {
        const target = String(relation?.url?.resource || '').trim()
        const type = String(relation?.type || '').trim()
        return target ? { target, type } : null
      })
      .filter(Boolean)
  }

  extractArtistImages (artist = {}) {
    return this.extractRelations(artist)
      .filter(relation => String(relation?.type || '').toLowerCase() === 'image')
      .map(relation => String(relation?.url?.resource || '').trim())
      .filter(Boolean)
      .map(url => ({
        coverType: 'poster',
        url,
        remoteUrl: url
      }))
  }

  extractExternalIds (artist = {}) {
    const ids = {}

    for (const relation of this.extractRelations(artist)) {
      const resource = String(relation?.url?.resource || '').trim()
      if (!resource) continue

      const discogsMatch = resource.match(/discogs\.com\/artist\/(\d+)/i)
      if (discogsMatch) {
        ids.discogsArtistId = discogsMatch[1]
      }
    }

    return ids
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

  redirectedOldIds (requestedId, resolvedId, oldIds = []) {
    const requested = String(requestedId || '').trim()
    const resolved = String(resolvedId || '').trim()
    const ids = Array.isArray(oldIds) ? oldIds : []

    if (requested && resolved && requested !== resolved) {
      ids.unshift(requested)
    }

    return [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))]
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

  coverArtUrl (releaseGroupId) {
    return releaseGroupId ? `https://coverartarchive.org/release-group/${releaseGroupId}/front` : ''
  }

  mapReleaseImages (releaseGroupId) {
    const url = this.coverArtUrl(releaseGroupId)
    return url
      ? [{
          coverType: 'cover',
          url,
          remoteUrl: url
        }]
      : []
  }

  mapBrowseReleases (group = {}, fallbackArtistId = '') {
    const rawReleases = Array.isArray(group.releases) ? group.releases : []

    return rawReleases.map((release) => {
      const media = Array.isArray(release.media) ? release.media : []
      const tracks = this.mapReleaseTracks(media, fallbackArtistId)
      const trackCount = tracks.length || Number(release['track-count'] || 0) || 0

      return {
        id: release.id || '',
        oldIds: [],
        title: release.title || group.title || '',
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
        trackCount,
        tracks
      }
    }).filter(release => release.id)
  }

  mapReleaseStatuses (releases = []) {
    const statuses = releases
      .map(release => String(release?.status || '').trim())
      .filter(Boolean)

    return [...new Set(statuses)].length > 0 ? [...new Set(statuses)] : ['Official']
  }

  mapReleaseGroupSummary (group = {}, fallbackArtistId = '') {
    const rawDate = group['first-release-date'] || ''
    const yearMatch = rawDate.match(/^(\d{4})/)
    const rating = this.mapRating(group)
    const id = group.id || ''
    const imageUrl = this.coverArtUrl(id)
    const releases = this.mapBrowseReleases(group, fallbackArtistId)
    const trackCounts = releases.map(release => Number(release.trackCount) || 0)
    const trackCount = trackCounts.length ? Math.max(...trackCounts) : 0
    const secondaryTypes = Array.isArray(group['secondary-types']) ? group['secondary-types'] : []
    const releaseStatuses = this.mapReleaseStatuses(releases)

    return {
      id,
      title: group.title || '',
      name: group.title || '',
      year: yearMatch ? parseInt(yearMatch[1], 10) : null,
      // MB returns YYYY, YYYY-MM, or YYYY-MM-DD. Preserve as-is; downstream
      // consumers can pad to full ISO for Lidarr compatibility.
      releaseDate: rawDate || null,
      trackCount,
      type: group['primary-type'] || 'Album',
      albumType: group['primary-type'] || 'Album',
      secondaryTypes,
      releaseStatuses,
      imageUrl,
      images: this.mapReleaseImages(id),
      remoteCover: imageUrl,
      rating,
      ratings: { votes: rating.count, value: rating.value },
      ids: {
        musicbrainzReleaseGroupId: id
      },
      provider: 'musicbrainz',
      releases
    }
  }

  hasUsableReleaseTracks (releases = []) {
    return releases.some(release => Array.isArray(release.tracks) && release.tracks.length > 0)
  }

  async fetchArtistReleasesByGroup (artistId) {
    if (!artistId) return new Map()

    const releasesByGroup = new Map()
    let offset = 0
    let fetchedPages = 0

    while (fetchedPages < MUSICBRAINZ_RELEASE_PAGE_LIMIT) {
      const releaseResult = await upstreamService.musicBrainzGet('/release', {
        artist: artistId,
        inc: 'release-groups+media+recordings+artist-credits',
        limit: MUSICBRAINZ_RELEASE_PAGE_SIZE,
        offset
      })

      const releases = Array.isArray(releaseResult?.releases) ? releaseResult.releases : []

      for (const release of releases) {
        const rgId = release['release-group']?.id
        if (!rgId) continue

        if (!releasesByGroup.has(rgId)) {
          releasesByGroup.set(rgId, [])
        }
        releasesByGroup.get(rgId).push(release)
      }

      fetchedPages += 1
      offset += MUSICBRAINZ_RELEASE_PAGE_SIZE

      const total = Number(releaseResult?.count ?? 0) || 0
      if (releases.length < MUSICBRAINZ_RELEASE_PAGE_SIZE || (total > 0 && offset >= total)) {
        break
      }
    }

    return releasesByGroup
  }

  async fetchReleaseGroupsByArtist (artistId) {
    if (!artistId) return []

    const releaseGroups = []
    let offset = 0
    let fetchedPages = 0

    while (fetchedPages < MUSICBRAINZ_RELEASE_GROUP_PAGE_LIMIT) {
      const releaseGroupResult = await upstreamService.musicBrainzGet('/release-group', {
        artist: artistId,
        inc: 'ratings',
        limit: MUSICBRAINZ_RELEASE_GROUP_PAGE_SIZE,
        offset
      })

      const pageReleaseGroups = Array.isArray(releaseGroupResult?.['release-groups'])
        ? releaseGroupResult['release-groups']
        : []

      releaseGroups.push(...pageReleaseGroups)

      fetchedPages += 1
      offset += MUSICBRAINZ_RELEASE_GROUP_PAGE_SIZE

      const total = Number(releaseGroupResult?.count ?? 0) || 0
      if (pageReleaseGroups.length < MUSICBRAINZ_RELEASE_GROUP_PAGE_SIZE || (total > 0 && offset >= total)) {
        break
      }
    }

    return releaseGroups
  }

  applyReleasesToSummary (summary, rawReleases, fallbackArtistId) {
    const releases = this.mapReleases({ releases: rawReleases }, fallbackArtistId)

    if (releases.length === 0) {
      return summary
    }

    const trackCounts = releases.map(release => Number(release.trackCount) || 0)

    return {
      ...summary,
      trackCount: trackCounts.length ? Math.max(...trackCounts) : summary.trackCount,
      releaseStatuses: this.mapReleaseStatuses(releases),
      releases
    }
  }

  enrichReleaseGroupSummary (summary, fallbackArtistId, releasesByGroup) {
    if (!summary?.id || this.hasUsableReleaseTracks(summary.releases)) {
      return summary
    }

    const rawReleases = releasesByGroup.get(summary.id) || []
    return this.applyReleasesToSummary(summary, rawReleases, fallbackArtistId)
  }

  async fetchReleaseGroupReleases (releaseGroupId) {
    if (!releaseGroupId) return []

    const releaseResult = await upstreamService.musicBrainzGet('/release', {
      'release-group': releaseGroupId,
      inc: 'media+recordings+artist-credits',
      limit: 10,
      offset: 0
    })

    return Array.isArray(releaseResult?.releases) ? releaseResult.releases : []
  }

  async enrichMissingReleaseGroupSummary (summary, fallbackArtistId, releaseGroupReleasesCache = new Map()) {
    if (!summary?.id || this.hasUsableReleaseTracks(summary.releases)) {
      return summary
    }

    try {
      let rawReleases = releaseGroupReleasesCache.get(summary.id)
      if (!rawReleases) {
        rawReleases = await this.fetchReleaseGroupReleases(summary.id)
        releaseGroupReleasesCache.set(summary.id, rawReleases)
      }
      return this.applyReleasesToSummary(summary, rawReleases, fallbackArtistId)
    } catch (err) {
      return summary
    }
  }

  async mapReleaseGroupSummaries (releaseGroups = [], fallbackArtistId = '') {
    const releasesByGroup = await this.fetchArtistReleasesByGroup(fallbackArtistId)
    const releaseGroupReleasesCache = new Map()

    const summaries = releaseGroups
      .filter((group) => {
        return group?.id && group?.title
      })
      .map(group => this.mapReleaseGroupSummary(group, fallbackArtistId))
      .filter(album => album.name)
      .map(summary => this.enrichReleaseGroupSummary(summary, fallbackArtistId, releasesByGroup))

    const enrichedSummaries = []
    for (const summary of summaries) {
      enrichedSummaries.push(await this.enrichMissingReleaseGroupSummary(summary, fallbackArtistId, releaseGroupReleasesCache))
    }

    return enrichedSummaries
  }

  async searchArtist (term) {
    const artistSearch = await upstreamService.musicBrainzGet('/artist', {
      query: `artist:"${this.mbQueryValue(term)}"`,
      inc: 'aliases',
      limit: MUSICBRAINZ_ARTIST_SEARCH_LIMIT
    })
    const artist = this.selectBestArtist(artistSearch, term)

    if (!artist) {
      return { artistName: term, albums: [] }
    }

    // Browse API only supports 'artist-credits' as a subquery inc plus misc
    // includes like 'ratings'. 'releases' is a lookup-only inc and causes a 400.
    const releaseGroups = await this.fetchReleaseGroupsByArtist(artist.id)
    const albums = await this.mapReleaseGroupSummaries(releaseGroups, artist.id || '')

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
      links: this.extractLinks(artist),
      ids: {
        musicbrainzArtistId: artist.id || '',
        ...this.extractExternalIds(artist)
      },
      albums
    }
  }

  async lookupArtistById (artistId) {
    const artist = await upstreamService.musicBrainzGet(`/artist/${encodeURIComponent(artistId)}`, {
      inc: 'aliases+url-rels'
    })

    if (!artist?.id) {
      const err = new Error('MusicBrainz artist not found')
      err.code = 'ARTIST_NOT_FOUND'
      throw err
    }

    // Browse API only supports 'artist-credits' as a subquery inc plus misc
    // includes like 'ratings'. 'releases' is a lookup-only inc and causes a 400.
    const releaseGroups = await this.fetchReleaseGroupsByArtist(artist.id)
    const albums = await this.mapReleaseGroupSummaries(releaseGroups, artist.id || '')

    return {
      schemaVersion: 'skyhook-v1',
      artistName: artist.name || artist['sort-name'] || '',
      id: artist.id || '',
      disambiguation: artist.disambiguation || '',
      overview: artist.disambiguation || '',
      oldIds: this.redirectedOldIds(artistId, artist.id),
      aliases: this.extractAliases(artist),
      artistAliases: this.extractAliases(artist),
      links: this.extractLinks(artist),
      images: this.extractArtistImages(artist),
      ids: {
        musicbrainzArtistId: artist.id || '',
        ...this.extractExternalIds(artist)
      },
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
    const imageUrl = this.coverArtUrl(group.id)

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
      imageUrl,
      rating,
      ratings: { votes: rating.count, value: rating.value },
      images: this.mapReleaseImages(group.id),
      remoteCover: imageUrl,
      ids: {
        musicbrainzReleaseGroupId: group.id || releaseGroupId
      },
      provider: 'musicbrainz',
      oldIds: this.redirectedOldIds(releaseGroupId, group.id),
      type: group['primary-type'] || 'Album',
      albumType: group['primary-type'] || 'Album',
      secondaryTypes: group['secondary-types'] || [],
      releaseStatuses: ['Official'],
      releases
    }
  }
}

module.exports = new MusicBrainzProvider()

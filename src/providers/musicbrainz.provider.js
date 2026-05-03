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
        return {
          name: group.title || '',
          year: yearMatch ? parseInt(yearMatch[1], 10) : null,
          // MB returns YYYY, YYYY-MM, or YYYY-MM-DD. Preserve as-is; downstream
          // consumers can pad to full ISO for Lidarr compatibility.
          releaseDate: rawDate || null,
          imageUrl: group.id ? `https://coverartarchive.org/release-group/${group.id}/front-250` : '',
          ids: {
            musicbrainzReleaseGroupId: group.id || ''
          }
        }
      }).filter(a => a.name)

    return {
      schemaVersion: 'skyhook-v1',
      artistName: artist.name || artist['sort-name'] || '',
      id: artist.id || '',
      disambiguation: artist.disambiguation || '',
      overview: artist.disambiguation || '',
      aliases: this.extractAliases(artist),
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
        return {
          name: group.title || '',
          year: yearMatch ? parseInt(yearMatch[1], 10) : null,
          releaseDate: rawDate || null,
          imageUrl: group.id ? `https://coverartarchive.org/release-group/${group.id}/front-250` : '',
          ids: {
            musicbrainzReleaseGroupId: group.id || ''
          },
          provider: 'musicbrainz'
        }
      }).filter(a => a.name)

    return {
      schemaVersion: 'skyhook-v1',
      artistName: artist.name || artist['sort-name'] || '',
      id: artist.id || '',
      disambiguation: artist.disambiguation || '',
      overview: artist.disambiguation || '',
      aliases: this.extractAliases(artist),
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
}

module.exports = new MusicBrainzProvider()

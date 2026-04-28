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
        const yearMatch = (group['first-release-date'] || '').match(/^(\d{4})/)
        return {
          name: group.title || '',
          year: yearMatch ? parseInt(yearMatch[1], 10) : null,
          imageUrl: group.id ? `https://coverartarchive.org/release-group/${group.id}/front-250` : '',
          ids: {
            musicbrainzReleaseGroupId: group.id || ''
          }
        }
      }).filter(a => a.name)

    return {
      artistName: artist.name || artist['sort-name'] || '',
      albums
    }
  }
}

module.exports = new MusicBrainzProvider()

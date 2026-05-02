const axios = require('axios')
const { getConfigValue } = require('../settings/store')
const { httpsAgent } = require('./http')

function upgradeArtworkUrl (url) {
  return String(url || '').replace(/100x100bb\.jpg$/, '600x600bb.jpg')
}

function normalizeName (value) {
  return String(value || '').trim().toLowerCase()
}

class ITunesProvider {
  constructor () {
    this.name = 'itunes'
  }

  async searchArtist (term) {
    const response = await axios.get('https://itunes.apple.com/search', {
      params: {
        term,
        media: 'music',
        entity: 'album',
        attribute: 'artistTerm',
        limit: 100,
        country: getConfigValue('itunesCountry') || 'US'
      },
      httpsAgent,
      timeout: getConfigValue('upstreamTimeoutMs') || 10000
    })

    const results = response.data?.results || []
    const normalizedTerm = normalizeName(term)
    const albums = results
      .filter((album) => {
        return album.wrapperType === 'collection' &&
          album.collectionName &&
          normalizeName(album.artistName) === normalizedTerm
      })
      .map((album) => {
        const rawDate = String(album.releaseDate || '')
        const yearMatch = rawDate.match(/^(\d{4})/)
        return {
          name: album.collectionName || '',
          year: yearMatch ? parseInt(yearMatch[1], 10) : null,
          // Apple returns ISO 8601 (e.g. "1997-05-21T07:00:00Z"). Preserve it
          // verbatim so downstream consumers (Lidarr) can use full precision
          // instead of a stripped year.
          releaseDate: rawDate || null,
          imageUrl: upgradeArtworkUrl(album.artworkUrl100),
          ids: {
            itunesCollectionId: album.collectionId ? String(album.collectionId) : ''
          }
        }
      })

    return {
      artistName: results[0]?.artistName || term,
      albums
    }
  }
}

module.exports = new ITunesProvider()

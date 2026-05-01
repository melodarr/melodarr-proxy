const axios = require('axios')
const dns = require('dns')
const https = require('https')
const { getConfigValue } = require('../settings/store')

const httpsAgent = new https.Agent({
  keepAlive: true,
  lookup (hostname, options, callback) {
    return dns.lookup(hostname, { ...options, family: 4 }, callback)
  }
})

class DiscogsProvider {
  constructor () {
    this.name = 'discogs'
  }

  getUserAgent () {
    const appName = getConfigValue('appName')
    const appVersion = getConfigValue('appVersion')
    return `${appName}/${appVersion} +https://github.com`
  }

  async searchArtist (term) {
    const token = getConfigValue('discogsToken')
    if (!token) {
      throw new Error('Discogs token not configured')
    }

    const headers = {
      'User-Agent': this.getUserAgent(),
      Authorization: `Discogs token=${token}`
    }
    const timeout = getConfigValue('upstreamTimeoutMs') || 10000

    try {
      // 1. Search for artist
      const searchRes = await axios.get('https://api.discogs.com/database/search', {
        params: { type: 'artist', q: term },
        headers,
        httpsAgent,
        timeout
      })

      const artists = searchRes.data?.results || []
      const exactMatch = artists.find(a => a.title?.toLowerCase() === term.toLowerCase()) || artists[0]

      if (!exactMatch) {
        return { artistName: term, albums: [] }
      }

      // 2. Get artist releases
      const releasesRes = await axios.get(`https://api.discogs.com/artists/${exactMatch.id}/releases`, {
        params: { sort: 'year', sort_order: 'asc', per_page: 100 },
        headers,
        httpsAgent,
        timeout
      })

      const releases = releasesRes.data?.releases || []
      const albums = releases
        .filter(r => r.type === 'master' || r.type === 'release')
        .map(r => {
          const year = r.year ? parseInt(r.year, 10) : null
          return {
            name: r.title || '',
            year,
            // Discogs only exposes year on the releases endpoint.
            releaseDate: year ? String(year) : null,
            imageUrl: r.thumb || '',
            ids: {
              discogsId: r.id ? String(r.id) : ''
            }
          }
        })
        .filter(a => a.name)

      return {
        artistName: exactMatch.title || term,
        albums
      }
    } catch (error) {
      if (error.response?.status === 404) {
        return { artistName: term, albums: [] }
      }
      throw error
    }
  }
}

module.exports = new DiscogsProvider()

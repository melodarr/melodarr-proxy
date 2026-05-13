const axios = require('axios')
const { getConfigValue } = require('../settings/store')
const { getProviderHttpsAgent, getProviderUserAgent } = require('./http')
const { enqueueProviderRequest } = require('../services/rate-limiter.service')

class DiscogsProvider {
  constructor () {
    this.name = 'discogs'
  }

  getUserAgent () {
    return getProviderUserAgent()
  }

  getAuthHeaders () {
    const token = getConfigValue('discogsToken')
    if (!token) {
      throw new Error('Discogs token not configured')
    }

    return {
      'User-Agent': this.getUserAgent(),
      Authorization: `Discogs token=${token}`
    }
  }

  getRequestOptions () {
    return {
      headers: this.getAuthHeaders(),
      httpsAgent: getProviderHttpsAgent(getConfigValue('discogsIpFamily') || getConfigValue('providerIpFamily')),
      timeout: getConfigValue('upstreamTimeoutMs') || 10000
    }
  }

  mapArtistImages (artist = {}) {
    const images = Array.isArray(artist.images) ? artist.images : []
    const urls = [
      ...images.map(image => image?.uri || image?.resource_url),
      artist.cover_image,
      artist.thumb
    ].filter(Boolean)

    return [...new Set(urls)].map(url => ({
      coverType: 'poster',
      url,
      remoteUrl: url
    }))
  }

  async lookupArtistById (artistId) {
    const normalizedId = String(artistId || '').trim()
    if (!normalizedId) {
      throw new Error('Discogs artist id is required')
    }

    const options = this.getRequestOptions()

    try {
      const artistRes = await enqueueProviderRequest('discogs', () => axios.get(`https://api.discogs.com/artists/${encodeURIComponent(normalizedId)}`, options))
      const artist = artistRes.data || {}

      return {
        artistName: artist.name || '',
        overview: artist.profile || '',
        images: this.mapArtistImages(artist),
        ids: {
          discogsArtistId: normalizedId
        }
      }
    } catch (error) {
      if (error.response?.status === 404) {
        return null
      }
      throw error
    }
  }

  async searchArtist (term) {
    const options = this.getRequestOptions()

    try {
      // 1. Search for artist
      const searchRes = await enqueueProviderRequest('discogs', () => axios.get('https://api.discogs.com/database/search', {
        params: { type: 'artist', q: term },
        ...options
      }))

      const artists = searchRes.data?.results || []
      const exactMatch = artists.find(a => a.title?.toLowerCase() === term.toLowerCase()) || artists[0]

      if (!exactMatch) {
        return { artistName: term, albums: [] }
      }

      // 2. Get artist releases
      const releasesRes = await enqueueProviderRequest('discogs', () => axios.get(`https://api.discogs.com/artists/${exactMatch.id}/releases`, {
        params: { sort: 'year', sort_order: 'asc', per_page: 100 },
        ...options
      }))

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
        images: this.mapArtistImages(exactMatch),
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

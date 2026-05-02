const axios = require('axios')
const https = require('https')
const { getConfigValue } = require('../settings/store')
const { pickLargestImage } = require('./http')

const httpsAgent = new https.Agent({
  keepAlive: true
})

class LastFmProvider {
  constructor () {
    this.name = 'lastfm'
  }

  async searchArtist (term) {
    const apiKey = getConfigValue('lastfmApiKey')
    if (!apiKey) {
      throw new Error('LastFM API key not configured')
    }

    try {
      const [infoResponse, albumsResponse] = await Promise.allSettled([
        axios.get('https://ws.audioscrobbler.com/2.0/', {
          params: {
            method: 'artist.getinfo',
            artist: term,
            api_key: apiKey,
            format: 'json'
          },
          httpsAgent,
          timeout: getConfigValue('upstreamTimeoutMs') || 10000
        }),
        axios.get('https://ws.audioscrobbler.com/2.0/', {
          params: {
            method: 'artist.gettopalbums',
            artist: term,
            api_key: apiKey,
            format: 'json',
            limit: 50
          },
          httpsAgent,
          timeout: getConfigValue('upstreamTimeoutMs') || 10000
        })
      ])

      if (albumsResponse.status === 'rejected') {
        if (albumsResponse.reason.response?.status === 404) {
          return { artistName: term, albums: [] }
        }
        throw albumsResponse.reason
      }

      const albumsData = albumsResponse.value.data?.topalbums?.album || []
      const albumsArray = Array.isArray(albumsData) ? albumsData : [albumsData]

      const albums = albumsArray.map(album => {
        return {
          name: album.name || '',
          year: null, // Last.fm top albums doesn't return release year consistently in this endpoint
          imageUrl: pickLargestImage(album.image),
          ids: {
            musicbrainzAlbumId: album.mbid || ''
          }
        }
      }).filter(a => a.name && a.name !== '(null)')

      const mbid = infoResponse.status === 'fulfilled' ? infoResponse.value.data?.artist?.mbid : ''

      return {
        artistName: albumsResponse.value.data?.topalbums?.['@attr']?.artist || term,
        albums,
        id: mbid || '',
        ids: mbid ? { musicbrainzArtistId: mbid } : undefined
      }
    } catch (error) {
      if (error.response?.status === 404) {
        return { artistName: term, albums: [] }
      }
      throw error
    }
  }
}

module.exports = new LastFmProvider()

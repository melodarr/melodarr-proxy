const axios = require('axios')
const { getConfigValue } = require('../settings/store')
const { httpsAgent } = require('./http')

class TheAudioDbProvider {
  constructor () {
    this.name = 'theaudiodb'
  }

  async searchArtist (term) {
    const apiKey = getConfigValue('theAudioDbApiKey')
    if (!apiKey) {
      throw new Error('TheAudioDB API key not configured')
    }

    const response = await axios.get(`https://www.theaudiodb.com/api/v1/json/${encodeURIComponent(apiKey)}/searchalbum.php`, {
      params: { s: term },
      httpsAgent,
      timeout: getConfigValue('upstreamTimeoutMs') || 10000
    })

    const albumsData = response.data?.album || []
    const albumsArray = Array.isArray(albumsData) ? albumsData : [albumsData]

    const albums = albumsArray
      .map((album) => ({
        name: album.strAlbum || '',
        year: album.intYearReleased ? parseInt(album.intYearReleased, 10) : null,
        imageUrl: album.strAlbumThumb || '',
        ids: {
          theAudioDbAlbumId: album.idAlbum || ''
        }
      }))
      .filter((album) => album.name)

    return {
      artistName: albumsArray[0]?.strArtist || term,
      albums
    }
  }
}

module.exports = new TheAudioDbProvider()

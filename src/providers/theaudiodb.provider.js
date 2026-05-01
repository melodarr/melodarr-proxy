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
      .map((album) => {
        const year = album.intYearReleased ? parseInt(album.intYearReleased, 10) : null
        return {
          name: album.strAlbum || '',
          year,
          // TheAudioDB only exposes year — emit as a year string so the
          // Lidarr-response builder can pad to ISO 8601.
          releaseDate: year ? String(year) : null,
          imageUrl: album.strAlbumThumb || '',
          ids: {
            theAudioDbAlbumId: album.idAlbum || ''
          }
        }
      })
      .filter((album) => album.name)

    return {
      artistName: albumsArray[0]?.strArtist || term,
      albums
    }
  }
}

module.exports = new TheAudioDbProvider()

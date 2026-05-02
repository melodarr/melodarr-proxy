const axios = require('axios')
const { getConfigValue } = require('../settings/store')
const { httpsAgent } = require('./http')

class TheAudioDbProvider {
  constructor () {
    this.name = 'theaudiodb'
  }

  async searchArtistProfile (term) {
    const apiKey = getConfigValue('theAudioDbApiKey')
    if (!apiKey) {
      throw new Error('TheAudioDB API key not configured')
    }

    const response = await axios.get(`https://www.theaudiodb.com/api/v1/json/${encodeURIComponent(apiKey)}/search.php`, {
      params: { s: term },
      httpsAgent,
      timeout: getConfigValue('upstreamTimeoutMs') || 10000
    })

    const artistData = response.data?.artists || []
    const artistsArray = Array.isArray(artistData) ? artistData : [artistData]
    const artist = artistsArray.find(item => String(item?.strArtist || '').toLowerCase() === String(term).toLowerCase()) || artistsArray[0]

    if (!artist) {
      return null
    }

    return {
      artistName: artist.strArtist || term,
      overview: artist.strBiographyEN || '',
      images: [
        artist.strArtistThumb,
        artist.strArtistFanart,
        artist.strArtistLogo
      ].filter(Boolean).map(url => ({
        coverType: 'poster',
        url,
        remoteUrl: url
      })),
      ids: {
        theAudioDbArtistId: artist.idArtist || ''
      }
    }
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

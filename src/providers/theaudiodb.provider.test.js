const test = require('node:test')
const assert = require('node:assert')

function setupMocks () {
  delete require.cache[require.resolve('./theaudiodb.provider')]

  let axiosGetMock = async () => ({ data: { album: [] } })
  let getConfigValueMock = (key) => key === 'theAudioDbApiKey' ? 'test-key' : null

  require.cache[require.resolve('../settings/store')] = {
    exports: {
      getConfigValue: (key) => getConfigValueMock(key)
    }
  }

  require.cache[require.resolve('axios')] = {
    exports: {
      get: async (url, config) => axiosGetMock(url, config)
    }
  }

  const theAudioDbProvider = require('./theaudiodb.provider')
  return {
    theAudioDbProvider,
    setAxiosMock: (fn) => { axiosGetMock = fn },
    setConfigMock: (fn) => { getConfigValueMock = fn }
  }
}

test('TheAudioDb Provider', async (t) => {
  await t.test('searchArtist - returns mapped albums', async () => {
    const { theAudioDbProvider, setAxiosMock } = setupMocks()
    setAxiosMock(async (url, config) => {
      assert.ok(url.includes('theaudiodb.com/api/v1/json/test-key'))
      return {
        data: {
          album: [
            {
              strAlbum: 'Album 1',
              intYearReleased: '2020',
              strAlbumThumb: 'http://example.com/thumb.jpg',
              idAlbum: '12345',
              strArtist: 'Test Artist'
            },
            {
              // missing strAlbum
              strArtist: 'Test Artist'
            }
          ]
        }
      }
    })

    const result = await theAudioDbProvider.searchArtist('Test Artist')
    assert.strictEqual(result.artistName, 'Test Artist')
    assert.strictEqual(result.albums.length, 1)

    const album = result.albums[0]
    assert.strictEqual(album.name, 'Album 1')
    assert.strictEqual(album.year, 2020)
    // v0.3.36: TheAudioDB only exposes year — emit as year string.
    assert.strictEqual(album.releaseDate, '2020')
    assert.strictEqual(album.imageUrl, 'http://example.com/thumb.jpg')
    assert.strictEqual(album.ids.theAudioDbAlbumId, '12345')
  })

  await t.test('searchArtistProfile - returns artist images', async () => {
    const { theAudioDbProvider, setAxiosMock } = setupMocks()
    setAxiosMock(async (url, config) => {
      assert.ok(url.includes('theaudiodb.com/api/v1/json/test-key/search.php'))
      assert.deepStrictEqual(config.params, { s: 'Lorde' })
      return {
        data: {
          artists: [
            {
              idArtist: '111239',
              strArtist: 'Lorde',
              strBiographyEN: 'New Zealand artist.',
              strArtistThumb: 'https://example.test/lorde-thumb.jpg',
              strArtistFanart: 'https://example.test/lorde-fanart.jpg',
              strArtistLogo: 'https://example.test/lorde-logo.png'
            }
          ]
        }
      }
    })

    const result = await theAudioDbProvider.searchArtistProfile('Lorde')
    assert.strictEqual(result.artistName, 'Lorde')
    assert.strictEqual(result.overview, 'New Zealand artist.')
    assert.strictEqual(result.ids.theAudioDbArtistId, '111239')
    assert.deepStrictEqual(result.images, [
      {
        coverType: 'poster',
        url: 'https://example.test/lorde-thumb.jpg',
        remoteUrl: 'https://example.test/lorde-thumb.jpg'
      },
      {
        coverType: 'fanart',
        url: 'https://example.test/lorde-fanart.jpg',
        remoteUrl: 'https://example.test/lorde-fanart.jpg'
      },
      {
        coverType: 'clearlogo',
        url: 'https://example.test/lorde-logo.png',
        remoteUrl: 'https://example.test/lorde-logo.png'
      }
    ])
  })

  await t.test('searchArtistProfile - returns null if no artist found', async () => {
    const { theAudioDbProvider, setAxiosMock } = setupMocks()
    setAxiosMock(async () => ({ data: { artists: null } }))

    const result = await theAudioDbProvider.searchArtistProfile('missing')
    assert.strictEqual(result, null)
  })

  await t.test('searchArtist - throws if no API key configured', async () => {
    const { theAudioDbProvider, setConfigMock } = setupMocks()
    setConfigMock(() => null)

    await assert.rejects(
      theAudioDbProvider.searchArtist('Test Artist'),
      /TheAudioDB API key not configured/
    )
  })

  await t.test('searchArtist - returns empty if no results', async () => {
    const { theAudioDbProvider, setAxiosMock } = setupMocks()
    setAxiosMock(async () => ({ data: { album: null } }))

    const result = await theAudioDbProvider.searchArtist('not found')
    assert.strictEqual(result.artistName, 'not found')
    assert.strictEqual(result.albums.length, 0)
  })
})

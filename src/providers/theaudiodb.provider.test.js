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
    assert.strictEqual(album.imageUrl, 'http://example.com/thumb.jpg')
    assert.strictEqual(album.ids.theAudioDbAlbumId, '12345')
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

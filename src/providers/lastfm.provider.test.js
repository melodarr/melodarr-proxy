const test = require('node:test')
const assert = require('node:assert')

function setupMocks () {
  delete require.cache[require.resolve('./lastfm.provider')]

  let axiosGetMock = async () => ({ data: {} })
  let getConfigValueMock = (key) => key === 'lastfmApiKey' ? 'test-key' : null

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

  const lastfmProvider = require('./lastfm.provider')
  return {
    lastfmProvider,
    setAxiosMock: (fn) => { axiosGetMock = fn },
    setConfigMock: (fn) => { getConfigValueMock = fn }
  }
}

test('LastFM Provider', async (t) => {
  await t.test('searchArtist - returns mapped albums', async () => {
    const { lastfmProvider, setAxiosMock } = setupMocks()
    setAxiosMock(async (url, config) => {
      assert.ok(url.includes('ws.audioscrobbler.com/2.0/'))
      assert.strictEqual(config.params.api_key, 'test-key')
      return {
        data: {
          topalbums: {
            '@attr': { artist: 'Test Artist' },
            album: [
              {
                name: 'Album 1',
                image: [
                  { '#text': 'http://example.com/small.jpg', size: 'small' },
                  { '#text': 'http://example.com/extralarge.jpg', size: 'extralarge' }
                ],
                mbid: 'mbid-1'
              },
              {
                name: '(null)' // should be filtered out
              }
            ]
          }
        }
      }
    })

    const result = await lastfmProvider.searchArtist('Test Artist')
    assert.strictEqual(result.artistName, 'Test Artist')
    assert.strictEqual(result.albums.length, 1)

    const album = result.albums[0]
    assert.strictEqual(album.name, 'Album 1')
    assert.strictEqual(album.year, null)
    assert.strictEqual(album.imageUrl, 'http://example.com/extralarge.jpg')
    assert.strictEqual(album.ids.musicbrainzAlbumId, 'mbid-1')
  })

  await t.test('searchArtist - returns empty if no topalbums', async () => {
    const { lastfmProvider, setAxiosMock } = setupMocks()
    setAxiosMock(async () => ({ data: {} }))

    const result = await lastfmProvider.searchArtist('Not Found')
    assert.strictEqual(result.artistName, 'Not Found')
    assert.strictEqual(result.albums.length, 0)
  })

  await t.test('searchArtist - handles 404', async () => {
    const { lastfmProvider, setAxiosMock } = setupMocks()
    setAxiosMock(async () => {
      const error = new Error('Not Found')
      error.response = { status: 404 }
      throw error
    })

    const result = await lastfmProvider.searchArtist('Artist')
    assert.strictEqual(result.artistName, 'Artist')
    assert.strictEqual(result.albums.length, 0)
  })

  await t.test('searchArtist - throws on non-404 error', async () => {
    const { lastfmProvider, setAxiosMock } = setupMocks()
    setAxiosMock(async () => {
      throw new Error('Network Error')
    })

    await assert.rejects(
      lastfmProvider.searchArtist('Artist'),
      /Network Error/
    )
  })

  await t.test('searchArtist - throws if no API key configured', async () => {
    const { lastfmProvider, setConfigMock } = setupMocks()
    setConfigMock(() => null)

    await assert.rejects(
      lastfmProvider.searchArtist('Artist'),
      /LastFM API key not configured/
    )
  })
})

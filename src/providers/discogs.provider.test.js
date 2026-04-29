const test = require('node:test')
const assert = require('node:assert')

function setupMocks () {
  delete require.cache[require.resolve('./discogs.provider')]

  let axiosGetMock = async () => ({ data: {} })
  let getConfigValueMock = (key) => {
    if (key === 'discogsToken') return 'test-token'
    if (key === 'appName') return 'TestApp'
    if (key === 'appVersion') return '1.0.0'
    return null
  }

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

  const discogsProvider = require('./discogs.provider')
  return {
    discogsProvider,
    setAxiosMock: (fn) => { axiosGetMock = fn },
    setConfigMock: (fn) => { getConfigValueMock = fn }
  }
}

test('Discogs Provider', async (t) => {
  await t.test('searchArtist - returns exact match artist and albums', async () => {
    const { discogsProvider, setAxiosMock } = setupMocks()
    setAxiosMock(async (url, config) => {
      assert.strictEqual(config.headers.Authorization, 'Discogs token=test-token')
      assert.ok(config.headers['User-Agent'].includes('TestApp/1.0.0'))

      if (url.includes('/database/search')) {
        return {
          data: {
            results: [
              { id: 123, title: 'Not Match' },
              { id: 456, title: 'Exact Match' }
            ]
          }
        }
      }

      if (url.includes('/artists/456/releases')) {
        return {
          data: {
            releases: [
              { id: 101, title: 'Album 1', year: '2020', type: 'master', thumb: 'http://example.com/1.jpg' },
              { id: 102, title: 'Album 2', type: 'release', thumb: 'http://example.com/2.jpg' },
              { id: 103, title: 'Video', type: 'video' } // should be filtered out
            ]
          }
        }
      }

      throw new Error(`Unexpected url: ${url}`)
    })

    const result = await discogsProvider.searchArtist('Exact Match')
    assert.strictEqual(result.artistName, 'Exact Match')
    assert.strictEqual(result.albums.length, 2)

    assert.strictEqual(result.albums[0].name, 'Album 1')
    assert.strictEqual(result.albums[0].year, 2020)
    assert.strictEqual(result.albums[0].imageUrl, 'http://example.com/1.jpg')
    assert.strictEqual(result.albums[0].ids.discogsId, '101')

    assert.strictEqual(result.albums[1].name, 'Album 2')
    assert.strictEqual(result.albums[1].year, null)
  })

  await t.test('searchArtist - returns empty if no artists found', async () => {
    const { discogsProvider, setAxiosMock } = setupMocks()
    setAxiosMock(async (url) => {
      if (url.includes('/database/search')) {
        return { data: { results: [] } }
      }
    })

    const result = await discogsProvider.searchArtist('Not Found')
    assert.strictEqual(result.artistName, 'Not Found')
    assert.strictEqual(result.albums.length, 0)
  })

  await t.test('searchArtist - handles 404 on releases', async () => {
    const { discogsProvider, setAxiosMock } = setupMocks()
    setAxiosMock(async (url) => {
      if (url.includes('/database/search')) {
        return { data: { results: [{ id: 1, title: 'Artist' }] } }
      }
      const error = new Error('Not Found')
      error.response = { status: 404 }
      throw error
    })

    const result = await discogsProvider.searchArtist('Artist')
    assert.strictEqual(result.artistName, 'Artist')
    assert.strictEqual(result.albums.length, 0)
  })

  await t.test('searchArtist - throws on non-404 error', async () => {
    const { discogsProvider, setAxiosMock } = setupMocks()
    setAxiosMock(async () => {
      throw new Error('Network Error')
    })

    await assert.rejects(
      discogsProvider.searchArtist('Artist'),
      /Network Error/
    )
  })

  await t.test('searchArtist - throws if no token configured', async () => {
    const { discogsProvider, setConfigMock } = setupMocks()
    setConfigMock(() => null)

    await assert.rejects(
      discogsProvider.searchArtist('Artist'),
      /Discogs token not configured/
    )
  })
})

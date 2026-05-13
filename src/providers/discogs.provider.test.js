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
    // v0.3.36: Discogs only exposes year — emit as year string.
    assert.strictEqual(result.albums[0].releaseDate, '2020')
    assert.strictEqual(result.albums[0].imageUrl, 'http://example.com/1.jpg')
    assert.strictEqual(result.albums[0].ids.discogsId, '101')

    assert.strictEqual(result.albums[1].name, 'Album 2')
    assert.strictEqual(result.albums[1].year, null)
    assert.strictEqual(result.albums[1].releaseDate, null)
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

  await t.test('lookupArtistById - returns only primary image when artist has multiple images', async () => {
    const { discogsProvider, setAxiosMock } = setupMocks()
    setAxiosMock(async (url, config) => {
      assert.strictEqual(url, 'https://api.discogs.com/artists/13759927')
      assert.strictEqual(config.headers.Authorization, 'Discogs token=test-token')
      return {
        data: {
          name: 'BENNETT',
          profile: 'DJ and producer from Koblenz, Germany',
          images: [
            { type: 'primary', uri: 'https://img.discogs.com/bennett-primary.jpg' },
            { type: 'secondary', uri: 'https://img.discogs.com/bennett-secondary-1.jpg' },
            { type: 'secondary', uri: 'https://img.discogs.com/bennett-secondary-2.jpg' }
          ]
        }
      }
    })

    const result = await discogsProvider.lookupArtistById('13759927')

    assert.strictEqual(result.artistName, 'BENNETT')
    assert.strictEqual(result.overview, 'DJ and producer from Koblenz, Germany')
    assert.deepStrictEqual(result.ids, { discogsArtistId: '13759927' })
    assert.deepStrictEqual(result.images, [
      {
        coverType: 'poster',
        url: 'https://img.discogs.com/bennett-primary.jpg',
        remoteUrl: 'https://img.discogs.com/bennett-primary.jpg'
      }
    ])
  })

  await t.test('lookupArtistById - falls back to first image when no primary type is present', async () => {
    const { discogsProvider, setAxiosMock } = setupMocks()
    setAxiosMock(async () => ({
      data: {
        name: 'BENNETT',
        profile: '',
        images: [
          { uri: 'https://img.discogs.com/bennett-img1.jpg' },
          { uri: 'https://img.discogs.com/bennett-img2.jpg' }
        ]
      }
    }))

    const result = await discogsProvider.lookupArtistById('13759927')

    assert.strictEqual(result.images.length, 1)
    assert.strictEqual(result.images[0].url, 'https://img.discogs.com/bennett-img1.jpg')
  })

  await t.test('lookupArtistById - returns null on missing linked artist', async () => {
    const { discogsProvider, setAxiosMock } = setupMocks()
    setAxiosMock(async () => {
      const error = new Error('Not Found')
      error.response = { status: 404 }
      throw error
    })

    const result = await discogsProvider.lookupArtistById('999')
    assert.strictEqual(result, null)
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

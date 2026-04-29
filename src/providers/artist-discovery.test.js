const test = require('node:test')
const assert = require('node:assert')

function setupMocks () {
  delete require.cache[require.resolve('./artist-discovery')]

  let musicBrainzGetMock = async () => ({})
  let axiosGetMock = async () => ({ data: {} })
  const getConfigValueMock = (key) => null

  require.cache[require.resolve('../services/upstream.service')] = {
    exports: {
      musicBrainzGet: async (path, params) => musicBrainzGetMock(path, params)
    }
  }

  require.cache[require.resolve('axios')] = {
    exports: {
      get: async (url, config) => axiosGetMock(url, config)
    }
  }

  require.cache[require.resolve('../settings/store')] = {
    exports: {
      getConfigValue: (key) => getConfigValueMock(key)
    }
  }

  const discovery = require('./artist-discovery')
  return {
    discovery,
    setMbMock: (fn) => { musicBrainzGetMock = fn },
    setAxiosMock: (fn) => { axiosGetMock = fn }
  }
}

test('Artist Discovery Provider', async (t) => {
  await t.test('discoverArtists - artist', async () => {
    const { discovery, setMbMock } = setupMocks()
    setMbMock(async (path, params) => {
      assert.strictEqual(path, '/artist')
      return {
        artists: [
          { name: 'Test Artist', id: '1', score: '100' },
          { 'sort-name': 'Test Sort', id: '2', score: '90' }
        ]
      }
    })

    const result = await discovery.discoverArtists({ query: 'Test Artist', type: 'artist' })
    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].artistName, 'Test Artist')
    assert.strictEqual(result[1].artistName, 'Test Sort')
  })

  await t.test('discoverArtists - song', async () => {
    const { discovery, setMbMock } = setupMocks()
    setMbMock(async (path, params) => {
      assert.strictEqual(path, '/recording')
      return {
        recordings: [
          {
            title: 'Test Song',
            score: '100',
            id: 'rec1',
            'artist-credit': [
              { artist: { name: 'Test Artist', id: 'art1' } }
            ]
          }
        ]
      }
    })

    const result = await discovery.discoverArtists({ query: 'Test Song', type: 'song' })
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].artistName, 'Test Artist')
    assert.strictEqual(result[0].match, 'Test Song')
  })

  await t.test('discoverArtists - song fallback to itunes', async () => {
    const { discovery, setMbMock, setAxiosMock } = setupMocks()
    setMbMock(async () => { throw new Error('MB fail') })
    setAxiosMock(async (url) => {
      return {
        data: {
          results: [
            { artistName: 'iTunes Artist', trackName: 'Test Song', artistId: '1' }
          ]
        }
      }
    })

    const result = await discovery.discoverArtists({ query: 'Test Song', type: 'song' })
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].artistName, 'iTunes Artist')
    assert.strictEqual(result[0].source, 'itunes')
  })

  await t.test('discoverArtists - album', async () => {
    const { discovery, setMbMock } = setupMocks()
    setMbMock(async (path, params) => {
      assert.strictEqual(path, '/release-group')
      return {
        'release-groups': [
          {
            title: 'Test Album',
            score: '100',
            id: 'rg1',
            'artist-credit': [
              { artist: { name: 'Test Artist', id: 'art1' } }
            ]
          }
        ]
      }
    })

    const result = await discovery.discoverArtists({ query: 'Test Album', type: 'album' })
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].artistName, 'Test Artist')
  })

  await t.test('discoverArtists - album fallback to itunes', async () => {
    const { discovery, setMbMock, setAxiosMock } = setupMocks()
    setMbMock(async () => { throw new Error('MB fail') })
    setAxiosMock(async (url) => {
      return {
        data: {
          results: [
            { artistName: 'iTunes Artist', collectionName: 'Test Album', collectionId: '1' }
          ]
        }
      }
    })

    const result = await discovery.discoverArtists({ query: 'Test Album', type: 'album' })
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].match, 'Test Album')
  })

  await t.test('discoverArtists - empty query throws', async () => {
    const { discovery } = setupMocks()
    await assert.rejects(
      discovery.discoverArtists({ query: '' }),
      /Query is required/
    )
  })

  await t.test('findSongAlbums - combined results', async () => {
    const { discovery, setMbMock, setAxiosMock } = setupMocks()
    setMbMock(async () => {
      return {
        recordings: [
          {
            title: 'Test Song',
            releases: [
              { title: 'MB Album', id: 'rel1', date: '2020-01-01' }
            ]
          }
        ]
      }
    })
    setAxiosMock(async () => {
      return {
        data: {
          results: [
            {
              artistName: 'Test Artist',
              trackName: 'Test Song',
              collectionName: 'iTunes Album',
              releaseDate: '2021-01-01T00:00:00Z'
            }
          ]
        }
      }
    })

    const result = await discovery.findSongAlbums({ artist: 'Test Artist', song: 'Test Song' })
    assert.strictEqual(result.source, 'combined')
    assert.strictEqual(result.albums.length, 2)
  })

  await t.test('findSongAlbums - fails if both fail', async () => {
    const { discovery, setMbMock, setAxiosMock } = setupMocks()
    setMbMock(async () => { throw new Error('MB fail') })
    setAxiosMock(async () => { throw new Error('iTunes fail') })

    await assert.rejects(
      discovery.findSongAlbums({ artist: 'Test Artist', song: 'Test Song' }),
      /MB fail/
    )
  })

  await t.test('findSongAlbums - requires artist and song', async () => {
    const { discovery } = setupMocks()
    await assert.rejects(
      discovery.findSongAlbums({ artist: '', song: 'Test Song' }),
      /Artist and song are required/
    )
  })
})

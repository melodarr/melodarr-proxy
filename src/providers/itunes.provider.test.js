const test = require('node:test')
const assert = require('node:assert')

function setupMocks () {
  delete require.cache[require.resolve('./itunes.provider')]

  let axiosGetMock = async () => ({ data: { results: [] } })

  require.cache[require.resolve('axios')] = {
    exports: {
      get: async (url, config) => axiosGetMock(url, config)
    }
  }

  const itunesProvider = require('./itunes.provider')
  return { itunesProvider, setMock: (fn) => { axiosGetMock = fn } }
}

test('iTunes Provider', async (t) => {
  await t.test('searchArtist - returns albums with upgraded artwork', async () => {
    const { itunesProvider, setMock } = setupMocks()
    setMock(async (url, config) => {
      assert.ok(url.includes('itunes.apple.com/search'))
      return {
        data: {
          results: [
            {
              wrapperType: 'collection',
              collectionName: 'Album 1',
              artistName: 'Test Artist',
              releaseDate: '2022-05-10T07:00:00Z',
              artworkUrl100: 'http://example.com/100x100bb.jpg',
              collectionId: 12345
            },
            {
              wrapperType: 'track', // Should be ignored
              artistName: 'Test Artist'
            },
            {
              wrapperType: 'collection',
              collectionName: 'Album 2',
              artistName: 'Different Artist' // Should be ignored since artist name doesn't match
            }
          ]
        }
      }
    })

    const result = await itunesProvider.searchArtist('Test Artist')
    assert.strictEqual(result.artistName, 'Test Artist')
    assert.strictEqual(result.albums.length, 1)

    const album = result.albums[0]
    assert.strictEqual(album.name, 'Album 1')
    assert.strictEqual(album.year, 2022)
    // v0.3.36: full ISO date preserved alongside year for Lidarr compatibility.
    assert.strictEqual(album.releaseDate, '2022-05-10T07:00:00Z')
    assert.strictEqual(album.imageUrl, 'http://example.com/600x600bb.jpg')
    assert.strictEqual(album.ids.itunesCollectionId, '12345')
  })

  await t.test('searchArtist - returns empty if no results', async () => {
    const { itunesProvider, setMock } = setupMocks()
    setMock(async () => ({ data: { results: [] } }))

    const result = await itunesProvider.searchArtist('not found')
    assert.strictEqual(result.artistName, 'not found')
    assert.strictEqual(result.albums.length, 0)
  })
})

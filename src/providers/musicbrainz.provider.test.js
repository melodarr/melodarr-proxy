const test = require('node:test')
const assert = require('node:assert')

function setupMocks () {
  delete require.cache[require.resolve('./musicbrainz.provider')]

  let musicBrainzGetMock = async () => {}

  require.cache[require.resolve('../services/upstream.service')] = {
    exports: {
      musicBrainzGet: async (path, params) => musicBrainzGetMock(path, params)
    }
  }

  const musicbrainzProvider = require('./musicbrainz.provider')
  return { musicbrainzProvider, setMock: (fn) => { musicBrainzGetMock = fn } }
}

test('MusicBrainz Provider', async (t) => {
  await t.test('searchArtist - returns exact artist match and albums', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    setMock(async (path, params) => {
      if (path === '/artist') {
        return {
          artists: [
            { id: '123', name: 'exact match', 'sort-name': 'exact match' }
          ]
        }
      }
      if (path === '/release-group') {
        return {
          'release-groups': [
            { id: 'rg1', title: 'Album 1', 'primary-type': 'Album', 'first-release-date': '2020-01-01' },
            { id: 'rg2', title: 'EP 1', 'primary-type': 'EP', 'secondary-types': ['Compilation'] }, // filtered out
            { id: 'rg3', title: 'Album 2', 'primary-type': 'Album' }
          ]
        }
      }
    })

    const result = await musicbrainzProvider.searchArtist('exact match')
    assert.strictEqual(result.artistName, 'exact match')
    assert.strictEqual(result.albums.length, 2)
    assert.strictEqual(result.albums[0].name, 'Album 1')
    assert.strictEqual(result.albums[0].year, 2020)
    // v0.3.36: full date preserved alongside year.
    assert.strictEqual(result.albums[0].releaseDate, '2020-01-01')
    assert.ok(result.albums[0].imageUrl.includes('rg1'))
    assert.strictEqual(result.albums[1].name, 'Album 2')
    assert.strictEqual(result.albums[1].year, null)
    assert.strictEqual(result.albums[1].releaseDate, null)
  })

  await t.test('searchArtist - returns empty if no artist found', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    setMock(async (path, params) => {
      if (path === '/artist') return { artists: [] }
    })

    const result = await musicbrainzProvider.searchArtist('not found')
    assert.strictEqual(result.artistName, 'not found')
    assert.strictEqual(result.albums.length, 0)
  })
})

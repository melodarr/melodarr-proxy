const test = require('node:test')
const assert = require('node:assert')
const { withArtistLookupDefaults } = require('../utils/lidarrArtist')
const { toSkyhookSearchShape } = require('../utils/skyhook')

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
            {
              id: '123',
              name: 'exact match',
              'sort-name': 'exact match',
              aliases: [
                { name: ' Exact Alias ' },
                { 'sort-name': 'Sort Alias' },
                { name: '' }
              ]
            }
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
    assert.deepStrictEqual(result.aliases, ['Exact Alias', 'Sort Alias'])
    assert.deepStrictEqual(result.artistAliases, ['Exact Alias', 'Sort Alias'])
  })

  await t.test('searchArtist - maps MusicBrainz aliases through to Lidarr artistAliases', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    setMock(async (path) => {
      if (path === '/artist') {
        return {
          artists: [
            {
              id: '2f569e60-0a1b-4fb9-95a4-3dc1525d1aad',
              name: 'Backstreet Boys',
              'sort-name': 'Backstreet Boys',
              aliases: [
                { name: ' BSB ' },
                { name: 'Backstreet' }
              ]
            }
          ]
        }
      }
      if (path === '/release-group') {
        return { 'release-groups': [] }
      }
    })

    const musicBrainzArtist = await musicbrainzProvider.searchArtist('Backstreet Boys')
    const lidarrArtist = toSkyhookSearchShape([{
      ...musicBrainzArtist,
      type: 'artist',
      ids: { musicbrainzArtistId: musicBrainzArtist.id }
    }], 'artist')[0].artist

    assert.deepStrictEqual(musicBrainzArtist.aliases, ['BSB', 'Backstreet'])
    assert.deepStrictEqual(musicBrainzArtist.artistAliases, ['BSB', 'Backstreet'])
    assert.deepStrictEqual(lidarrArtist.aliases, ['BSB', 'Backstreet'])
    assert.deepStrictEqual(lidarrArtist.artistAliases, ['BSB', 'Backstreet'])
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

  await t.test('lookupArtistById - returns artist and albums by MBID', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    setMock(async (path, params) => {
      if (path === '/artist/a74b1b7f') {
        assert.strictEqual(params.inc, 'aliases')
        return {
          id: 'a74b1b7f',
          name: 'Radiohead',
          disambiguation: 'test artist',
          aliases: [
            { name: 'On a Friday' }
          ]
        }
      }
      if (path === '/release-group') {
        assert.strictEqual(params.artist, 'a74b1b7f')
        return {
          'release-groups': [
            { id: 'rg1', title: 'OK Computer', 'primary-type': 'Album', 'first-release-date': '1997-05-21' }
          ]
        }
      }
    })

    const result = await musicbrainzProvider.lookupArtistById('a74b1b7f')
    assert.strictEqual(result.artistName, 'Radiohead')
    assert.strictEqual(result.id, 'a74b1b7f')
    assert.strictEqual(result.albums.length, 1)
    assert.strictEqual(result.albums[0].provider, 'musicbrainz')
    assert.strictEqual(result.providers[0].name, 'musicbrainz')
    assert.deepStrictEqual(result.aliases, ['On a Friday'])
    assert.deepStrictEqual(result.artistAliases, ['On a Friday'])
    assert.deepStrictEqual(withArtistLookupDefaults(result).artistAliases, ['On a Friday'])
  })
})

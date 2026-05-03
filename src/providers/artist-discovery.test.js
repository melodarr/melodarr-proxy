const test = require('node:test')
const assert = require('node:assert')

function setupMocks ({ providers = 'musicbrainz,itunes,theaudiodb,discogs' } = {}) {
  delete require.cache[require.resolve('./artist-discovery')]
  delete require.cache[require.resolve('./theaudiodb.provider')]
  delete require.cache[require.resolve('./discogs.provider')]

  let musicBrainzGetMock = async () => ({})
  let axiosGetMock = async () => ({ data: {} })
  let theAudioDbMock = async () => ({ artistName: '', albums: [] })
  let discogsMock = async () => ({ artistName: '', albums: [] })
  let mbCalls = 0
  let itunesCalls = 0
  let theAudioDbCalls = 0
  let discogsCalls = 0
  const getConfigValueMock = (key) => {
    if (key === 'metadataProviders') return providers
    return null
  }

  require.cache[require.resolve('../services/upstream.service')] = {
    exports: {
      musicBrainzGet: async (path, params) => {
        mbCalls++
        return musicBrainzGetMock(path, params)
      }
    }
  }

  require.cache[require.resolve('axios')] = {
    exports: {
      get: async (url, config) => {
        if (typeof url === 'string' && url.includes('itunes.apple.com')) itunesCalls++
        return axiosGetMock(url, config)
      }
    }
  }

  require.cache[require.resolve('../settings/store')] = {
    exports: {
      getConfigValue: (key) => getConfigValueMock(key)
    }
  }

  require.cache[require.resolve('../utils/logger')] = {
    exports: { warn () {}, info () {}, error () {} }
  }

  require.cache[require.resolve('./theaudiodb.provider')] = {
    exports: {
      name: 'theaudiodb',
      searchArtist: async (term) => {
        theAudioDbCalls++
        return theAudioDbMock(term)
      },
      searchArtistProfile: async (term) => {
        theAudioDbCalls++
        return theAudioDbMock(term)
      }
    }
  }

  require.cache[require.resolve('./discogs.provider')] = {
    exports: {
      name: 'discogs',
      searchArtist: async (term) => {
        discogsCalls++
        return discogsMock(term)
      }
    }
  }

  const discovery = require('./artist-discovery')
  return {
    discovery,
    setMbMock: (fn) => { musicBrainzGetMock = fn },
    setAxiosMock: (fn) => { axiosGetMock = fn },
    setTheAudioDbMock: (fn) => { theAudioDbMock = fn },
    setDiscogsMock: (fn) => { discogsMock = fn },
    counts: () => ({ mb: mbCalls, itunes: itunesCalls, theaudiodb: theAudioDbCalls, discogs: discogsCalls })
  }
}

test('Artist Discovery Provider', async (t) => {
  await t.test('discoverArtists - artist', async () => {
    const { discovery, setMbMock } = setupMocks({ providers: 'musicbrainz' })
    setMbMock(async (path, params) => {
      assert.strictEqual(path, '/artist')
      assert.strictEqual(params.inc, 'aliases')
      return {
        artists: [
          {
            name: 'Test Artist',
            id: '1',
            score: '100',
            aliases: [
              { name: ' Test Alias ' },
              { 'sort-name': 'Sort Alias' }
            ]
          },
          { 'sort-name': 'Test Sort', id: '2', score: '90' }
        ]
      }
    })

    const result = await discovery.discoverArtists({ query: 'Test Artist', type: 'artist' })
    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].artistName, 'Test Artist')
    assert.deepStrictEqual(result[0].oldIds, [])
    assert.deepStrictEqual(result[0].aliases, ['Test Alias', 'Sort Alias'])
    assert.deepStrictEqual(result[0].artistAliases, ['Test Alias', 'Sort Alias'])
    assert.strictEqual(result[1].artistName, 'Test Sort')
  })

  await t.test('discoverArtists - artist enriches MB candidates with exact provider images', async () => {
    const { discovery, setMbMock, setTheAudioDbMock } = setupMocks({ providers: 'musicbrainz,theaudiodb' })
    setMbMock(async () => ({
      artists: [
        { name: 'Lorde', id: 'mb-lorde', score: '100' },
        { name: 'Other Lorde', id: 'mb-other', score: '70' }
      ]
    }))
    setTheAudioDbMock(async () => ({
      artistName: 'Lorde',
      images: [{ coverType: 'poster', url: 'https://example.test/lorde.jpg', remoteUrl: 'https://example.test/lorde.jpg' }],
      ids: { theAudioDbArtistId: '123' }
    }))

    const result = await discovery.discoverArtists({ query: 'Lorde', type: 'artist' })
    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].artistName, 'Lorde')
    assert.strictEqual(result[0].imageUrl, 'https://example.test/lorde.jpg')
    assert.deepStrictEqual(result[0].images, [{ coverType: 'poster', url: 'https://example.test/lorde.jpg', remoteUrl: 'https://example.test/lorde.jpg' }])
    assert.strictEqual(result[0].ids.musicbrainzArtistId, 'mb-lorde')
    assert.strictEqual(result[0].ids.theAudioDbArtistId, '123')
    assert.strictEqual(result[1].imageUrl, undefined)
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

  await t.test('discoverArtists - song fallback to itunes when MB fails', async () => {
    const { discovery, setMbMock, setAxiosMock } = setupMocks()
    setMbMock(async () => { throw new Error('MB fail') })
    setAxiosMock(async () => ({
      data: {
        results: [
          { artistName: 'iTunes Artist', trackName: 'Test Song', artistId: '1' }
        ]
      }
    }))

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

  await t.test('discoverArtists - album fallback to itunes when MB fails', async () => {
    const { discovery, setMbMock, setAxiosMock } = setupMocks()
    setMbMock(async () => { throw new Error('MB fail') })
    setAxiosMock(async () => ({
      data: {
        results: [
          { artistName: 'iTunes Artist', collectionName: 'Test Album', collectionId: '1' }
        ]
      }
    }))

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

  // ── v0.3.35 hotfix regressions ────────────────────────────────────

  await t.test('discoverArtists - artist falls back to iTunes when MB fails', async () => {
    const { discovery, setMbMock, setAxiosMock, counts } = setupMocks()
    setMbMock(async () => { throw new Error('ECONNRESET') })
    setAxiosMock(async () => ({
      data: { results: [{ artistName: 'Junkyards', artistId: '999' }] }
    }))

    const result = await discovery.discoverArtists({ query: 'junkyards', type: 'artist' })
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].source, 'itunes')
    assert.strictEqual(counts().mb, 1, 'MB tried once')
    assert.strictEqual(counts().itunes, 1, 'iTunes tried after MB failed')
  })

  await t.test('MB-disabled config never calls MusicBrainz', async () => {
    const { discovery, setMbMock, setAxiosMock, counts } = setupMocks({
      providers: 'itunes,theaudiodb,discogs'
    })
    setMbMock(async () => {
      throw new Error('MB should not be called when not in metadataProviders')
    })
    setAxiosMock(async () => ({
      data: { results: [{ artistName: 'Junkyards', artistId: '7' }] }
    }))

    const result = await discovery.discoverArtists({ query: 'junkyards', type: 'artist' })
    assert.strictEqual(counts().mb, 0, 'MB never called')
    assert.strictEqual(result[0].source, 'itunes')
  })

  await t.test('discoverArtists falls through to theaudiodb then discogs', async () => {
    const { discovery, setMbMock, setAxiosMock, setTheAudioDbMock, setDiscogsMock, counts } = setupMocks()
    setMbMock(async () => { throw new Error('MB down') })
    setAxiosMock(async () => { throw new Error('iTunes down') })
    setTheAudioDbMock(async () => { throw new Error('TAD down') })
    setDiscogsMock(async () => ({ artistName: 'Junkyards', albums: [] }))

    const result = await discovery.discoverArtists({ query: 'junkyards', type: 'artist' })
    assert.strictEqual(counts().mb, 1)
    assert.strictEqual(counts().itunes, 1)
    assert.strictEqual(counts().theaudiodb, 1)
    assert.strictEqual(counts().discogs, 1)
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].source, 'discogs')
  })

  await t.test('all providers fail → returns [] (no throw, no 502)', async () => {
    const { discovery, setMbMock, setAxiosMock, setTheAudioDbMock, setDiscogsMock } = setupMocks()
    setMbMock(async () => { throw new Error('MB fail') })
    setAxiosMock(async () => { throw new Error('iTunes fail') })
    setTheAudioDbMock(async () => { throw new Error('TAD fail') })
    setDiscogsMock(async () => { throw new Error('Discogs fail') })

    const result = await discovery.discoverArtists({ query: 'nobody', type: 'artist' })
    assert.deepStrictEqual(result, [])
  })

  await t.test('getEnabledProviders reflects metadataProviders config', async () => {
    const { discovery } = setupMocks({ providers: 'itunes,discogs' })
    const enabled = discovery.getEnabledProviders()
    assert.ok(enabled.has('itunes'))
    assert.ok(enabled.has('discogs'))
    assert.ok(!enabled.has('musicbrainz'))
  })

  // ── findSongAlbums ────────────────────────────────────────────────

  await t.test('findSongAlbums - combined results', async () => {
    const { discovery, setMbMock, setAxiosMock } = setupMocks()
    setMbMock(async () => ({
      recordings: [
        {
          title: 'Test Song',
          releases: [
            { title: 'MB Album', id: 'rel1', date: '2020-01-01' }
          ]
        }
      ]
    }))
    setAxiosMock(async () => ({
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
    }))

    const result = await discovery.findSongAlbums({ artist: 'Test Artist', song: 'Test Song' })
    assert.strictEqual(result.source, 'combined')
    assert.strictEqual(result.albums.length, 2)
  })

  await t.test('findSongAlbums - returns partial result when both fail (no throw)', async () => {
    const { discovery, setMbMock, setAxiosMock } = setupMocks()
    setMbMock(async () => { throw new Error('MB fail') })
    setAxiosMock(async () => { throw new Error('iTunes fail') })

    const result = await discovery.findSongAlbums({ artist: 'Test Artist', song: 'Test Song' })
    assert.deepStrictEqual(result.albums, [])
    assert.strictEqual(result.partial, true)
  })

  await t.test('findSongAlbums - MB disabled skips MB call', async () => {
    const { discovery, setAxiosMock, counts } = setupMocks({ providers: 'itunes' })
    setAxiosMock(async () => ({
      data: {
        results: [{
          artistName: 'Test Artist',
          trackName: 'Test Song',
          collectionName: 'iTunes Only Album',
          releaseDate: '2021-01-01'
        }]
      }
    }))

    const result = await discovery.findSongAlbums({ artist: 'Test Artist', song: 'Test Song' })
    assert.strictEqual(counts().mb, 0)
    assert.strictEqual(result.source, 'itunes')
    assert.strictEqual(result.albums.length, 1)
  })

  await t.test('findSongAlbums - requires artist and song', async () => {
    const { discovery } = setupMocks()
    await assert.rejects(
      discovery.findSongAlbums({ artist: '', song: 'Test Song' }),
      /Artist and song are required/
    )
  })
})

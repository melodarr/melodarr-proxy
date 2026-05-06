const test = require('node:test')
const assert = require('node:assert')

function setupMocks (providersStr, scoreFn) {
  // Clear cache for index.js
  delete require.cache[require.resolve('./index')]

  // Mock store
  require.cache[require.resolve('../settings/store')] = {
    exports: {
      getConfigValue: (key) => key === 'metadataProviders' ? providersStr : 'dummy'
    }
  }

  // Mock metrics
  const metricsMock = { recordProviderCall: () => {} }
  require.cache[require.resolve('../metrics')] = { exports: metricsMock }

  // Mock logger
  require.cache[require.resolve('../utils/logger')] = {
    exports: { error: () => {}, info: () => {} }
  }

  // Mock scoring
  require.cache[require.resolve('./scoring')] = {
    exports: { getProviderScore: scoreFn || (() => 0.8) }
  }

  const mockProviders = {
    dummy: {
      name: 'dummy',
      searchArtist: async (term) => ({
        artistName: 'Dummy Artist',
        oldIds: ['old-dummy'],
        aliases: ['Dummy Alias'],
        albums: [{ name: 'Album 1', year: 2020, ids: { dummy: '1' } }]
      })
    },
    dummy2: {
      name: 'dummy2',
      searchArtist: async (term) => ({
        artistName: 'Dummy Artist 2',
        albums: [{ name: 'Album 1', year: 2021, ids: { dummy2: '2' }, imageUrl: 'http://img.com/1' }]
      })
    },
    failing: {
      name: 'failing',
      searchArtist: async (term) => {
        const err = new Error(term === 'timeout' ? 'Provider timeout' : 'Provider failed')
        err.code = term === 'timeout' ? 'ECONNABORTED' : 500
        throw err
      }
    }
  }

  require.cache[require.resolve('./musicbrainz.provider')] = { exports: mockProviders.dummy }
  require.cache[require.resolve('./lastfm.provider')] = { exports: mockProviders.dummy2 }
  require.cache[require.resolve('./discogs.provider')] = { exports: mockProviders.failing }

  const index = require('./index')
  return { index, metricsMock }
}

test('Providers Index', async (t) => {
  await t.test('aggregateArtist - throws if no active providers', async () => {
    const { index } = setupMocks('invalidProvider')
    await assert.rejects(
      async () => index.aggregateArtist('test'),
      /No active metadata providers configured/
    )
  })

  await t.test('aggregateArtist - handles successful providers and merges data', async () => {
    const { index } = setupMocks('musicbrainz,lastfm', (provider) => provider === 'dummy' ? 0.9 : 0.8)
    const result = await index.aggregateArtist('test')

    assert.strictEqual(result.partial, false)
    assert.strictEqual(result.providerCount, 2)
    assert.strictEqual(result.artistName, 'Dummy Artist')
    assert.strictEqual(result.albums.length, 1)
    assert.strictEqual(result.albums[0].name, 'Album 1')
    assert.strictEqual(result.albums[0].year, 2020)
    assert.strictEqual(result.albums[0].imageUrl, 'http://img.com/1')
    assert.ok(result.albums[0].ids.dummy)
    assert.ok(result.albums[0].ids.dummy2)
    assert.deepStrictEqual(result.oldIds, ['old-dummy'])
    assert.deepStrictEqual(result.aliases, ['Dummy Alias'])
    assert.deepStrictEqual(result.artistAliases, ['Dummy Alias'])
  })

  await t.test('aggregateArtist - preserves distinct artist image cover types and album ratings', async () => {
    delete require.cache[require.resolve('./index')]
    require.cache[require.resolve('../settings/store')] = {
      exports: { getConfigValue: () => 'musicbrainz,theaudiodb' }
    }
    require.cache[require.resolve('../utils/logger')] = {
      exports: { error () {}, warn () {}, info () {} }
    }
    require.cache[require.resolve('../metrics')] = { exports: {} }
    require.cache[require.resolve('./scoring')] = {
      exports: { getProviderScore: (name) => name === 'musicbrainz' ? 0.95 : 0.9 }
    }
    require.cache[require.resolve('./musicbrainz.provider')] = {
      exports: {
        name: 'musicbrainz',
        searchArtist: async () => ({
          artistName: 'Akon',
          id: 'mb-akon',
          images: [],
          albums: [{
            name: 'Freedom',
            releaseDate: '2008-11-30',
            ids: { musicbrainzReleaseGroupId: 'rg-freedom' },
            rating: { count: 42, value: 4.5 },
            ratings: { votes: 42, value: 4.5 }
          }]
        })
      }
    }
    require.cache[require.resolve('./theaudiodb.provider')] = {
      exports: {
        name: 'theaudiodb',
        searchArtist: async () => ({
          artistName: 'Akon',
          images: [
            { coverType: 'poster', url: 'https://example.test/akon-thumb.jpg', remoteUrl: 'https://example.test/akon-thumb.jpg' },
            { coverType: 'fanart', url: 'https://example.test/akon-fanart.jpg', remoteUrl: 'https://example.test/akon-fanart.jpg' },
            { coverType: 'clearlogo', url: 'https://example.test/akon-logo.png', remoteUrl: 'https://example.test/akon-logo.png' }
          ],
          albums: [{
            name: 'Freedom',
            releaseDate: '2008-11-30',
            imageUrl: 'https://example.test/freedom.jpg',
            ids: { theAudioDbAlbumId: 'tadb-freedom' }
          }]
        })
      }
    }

    const index = require('./index')
    const result = await index.aggregateArtist('Akon')

    assert.deepStrictEqual(result.images.map(image => image.coverType), ['poster', 'fanart', 'clearlogo'])
    assert.deepStrictEqual(result.albums[0].rating, { count: 42, value: 4.5 })
    assert.deepStrictEqual(result.albums[0].ratings, { votes: 42, value: 4.5 })
    assert.strictEqual(result.albums[0].imageUrl, 'https://example.test/freedom.jpg')
  })

  await t.test('aggregateArtist - preserves aliases from the highest scored provider with aliases', async () => {
    delete require.cache[require.resolve('./index')]
    require.cache[require.resolve('../settings/store')] = {
      exports: { getConfigValue: () => 'musicbrainz,itunes' }
    }
    require.cache[require.resolve('../utils/logger')] = {
      exports: { error () {}, warn () {}, info () {} }
    }
    require.cache[require.resolve('../metrics')] = { exports: {} }
    require.cache[require.resolve('./scoring')] = {
      exports: { getProviderScore: (name) => name === 'musicbrainz' ? 0.95 : 0.5 }
    }
    require.cache[require.resolve('./musicbrainz.provider')] = {
      exports: {
        name: 'musicbrainz',
        searchArtist: async () => ({
          artistName: 'Backstreet Boys',
          oldIds: ['old-bsb'],
          aliases: ['BSB', 'Back Street Boys'],
          artistAliases: ['BSB', 'Back Street Boys'],
          albums: []
        })
      }
    }
    require.cache[require.resolve('./itunes.provider')] = {
      exports: {
        name: 'itunes',
        searchArtist: async () => ({
          artistName: 'Backstreet Boys',
          albums: []
        })
      }
    }

    const index = require('./index')
    const result = await index.aggregateArtist('Backstreet Boys')

    assert.deepStrictEqual(result.aliases, ['BSB', 'Back Street Boys'])
    assert.deepStrictEqual(result.artistAliases, ['BSB', 'Back Street Boys'])
    assert.deepStrictEqual(result.oldIds, ['old-bsb'])
  })

  await t.test('aggregateArtist - handles partial failures', async () => {
    const { index, metricsMock } = setupMocks('musicbrainz,discogs', () => 0.5)
    let metricsCalled = false
    metricsMock.recordProviderCall = (name, success) => {
      if (name === 'failing' && !success) metricsCalled = true
    }

    const result = await index.aggregateArtist('test')
    assert.strictEqual(result.partial, true)
    assert.strictEqual(result.providerCount, 1)
    assert.ok(result.warning.includes('Provider failed'))
    assert.ok(metricsCalled)
  })

  await t.test('aggregateArtist - marks timeout provider failures in metrics', async () => {
    const { index, metricsMock } = setupMocks('musicbrainz,discogs', () => 0.5)
    let timeoutRecorded = false
    metricsMock.recordProviderCall = (name, success, _duration, isTimeout) => {
      if (name === 'failing' && !success && isTimeout) timeoutRecorded = true
    }

    const result = await index.aggregateArtist('timeout')
    assert.strictEqual(result.partial, true)
    assert.ok(timeoutRecorded)
  })

  await t.test('aggregateArtist - merges releaseDate, prefers more precise (v0.3.36)', async () => {
    // Two providers return the same album with different date precision:
    // 'itunes' (lower score) carries a full ISO timestamp; 'musicbrainz'
    // (higher score) carries year-only. The merge must keep both providers'
    // contributions: high-scored provider wins identity (year, provider tag),
    // but releaseDate prefers the more precise string regardless of score.
    delete require.cache[require.resolve('./index')]
    require.cache[require.resolve('../settings/store')] = {
      exports: { getConfigValue: () => 'musicbrainz,itunes' }
    }
    require.cache[require.resolve('../utils/logger')] = {
      exports: { error () {}, warn () {}, info () {} }
    }
    require.cache[require.resolve('../metrics')] = { exports: {} }
    require.cache[require.resolve('./scoring')] = {
      exports: { getProviderScore: (name) => name === 'musicbrainz' ? 0.95 : 0.5 }
    }
    require.cache[require.resolve('./musicbrainz.provider')] = {
      exports: {
        name: 'musicbrainz',
        searchArtist: async () => ({
          artistName: 'X',
          albums: [{ name: 'Album', year: 1997, releaseDate: '1997', ids: { mb: '1' } }]
        })
      }
    }
    require.cache[require.resolve('./itunes.provider')] = {
      exports: {
        name: 'itunes',
        searchArtist: async () => ({
          artistName: 'X',
          albums: [{ name: 'Album', year: 1997, releaseDate: '1997-05-21T07:00:00Z', ids: { it: '2' } }]
        })
      }
    }

    const index = require('./index')
    const result = await index.aggregateArtist('X')

    assert.strictEqual(result.albums.length, 1)
    assert.strictEqual(result.albums[0].year, 1997)
    // The more precise releaseDate wins even though iTunes scored lower.
    assert.strictEqual(result.albums[0].releaseDate, '1997-05-21T07:00:00Z')
  })

  await t.test('aggregateArtist - throws if all providers fail', async () => {
    const { index } = setupMocks('discogs')
    await assert.rejects(
      async () => index.aggregateArtist('test'),
      /All metadata providers failed/
    )
  })

  await t.test('testProvider - returns info for a valid provider', async () => {
    const { index } = setupMocks('musicbrainz')
    const result = await index.testProvider('musicbrainz', 'test')
    assert.strictEqual(result.provider, 'dummy')
    assert.strictEqual(result.albumCount, 1)
    assert.strictEqual(result.sampleAlbums[0].name, 'Album 1')
  })

  await t.test('testProvider - throws for unknown provider', async () => {
    const { index } = setupMocks('musicbrainz')
    await assert.rejects(
      async () => index.testProvider('unknown', 'test'),
      /Unknown provider/
    )
  })
})

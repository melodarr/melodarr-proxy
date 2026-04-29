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
        const err = new Error('Provider failed')
        err.code = 500
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

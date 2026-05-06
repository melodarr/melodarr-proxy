const test = require('node:test')
const assert = require('node:assert/strict')

function setupMocks (providersStr, providersMocks) {
  // Clear caches
  delete require.cache[require.resolve('../providers/index')]
  delete require.cache[require.resolve('../providers/safeProviderCall')]
  delete require.cache[require.resolve('../health/providerHealth')]
  delete require.cache[require.resolve('../health/providerMetrics')]
  delete require.cache[require.resolve('../metrics/index')]

  require.cache[require.resolve('../settings/store')] = {
    exports: {
      getConfigValue: (key) => {
        if (key === 'metadataProviders') return providersStr
        if (key === 'upstreamTimeoutMs') return 1000 // Short timeout for load test
        return 'dummy'
      }
    }
  }

  require.cache[require.resolve('../utils/logger')] = {
    exports: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }
  }

  require.cache[require.resolve('../providers/scoring')] = {
    exports: { getProviderScore: () => 0.8 } // Default score
  }

  for (const [name, mock] of Object.entries(providersMocks)) {
    try {
      require.cache[require.resolve(`../providers/${name}.provider`)] = { exports: mock }
    } catch {
      const path = require('path')
      require.cache[path.resolve(__dirname, `../providers/${name}.provider.js`)] = { exports: mock }
    }
  }

  const index = require('../providers/index')
  const metrics = require('../metrics/index')

  return { index, metrics }
}

test('Load Simulation & Edge Case Verification', async (t) => {
  await t.test('simulates burst traffic and schema variance', async () => {
    // 1. Setup mock providers with varying data shapes and latency
    const musicbrainzProvider = {
      name: 'musicbrainz',
      searchArtist: async (artist) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50)) // Fast to medium
        return {
          artistName: artist,
          albums: [
            { name: 'Album 1', year: 2000, ids: { mb: 'mb-1' } },
            { name: 'Album 2', year: 2005, ids: { mb: 'mb-2' } }
          ]
        }
      }
    }

    const itunesProvider = {
      name: 'itunes',
      searchArtist: async (artist) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 30)) // Fast
        return {
          artistName: artist,
          albums: [
            { name: 'Album 1', releaseDate: '2000-01-01', ids: { itunes: 'it-1' } }, // Different schema fields
            { name: 'Album 2', releaseDate: '2005-05-05', ids: { itunes: 'it-2' } }
          ]
        }
      }
    }

    const lastfmProvider = {
      name: 'lastfm',
      searchArtist: async (artist) => {
        await new Promise(resolve => setTimeout(resolve, 1500)) // Will timeout (timeout=1000)
        return { artistName: artist, albums: [{ name: 'Never returned' }] }
      }
    }

    const { index, metrics } = setupMocks('musicbrainz,itunes,lastfm', {
      musicbrainz: musicbrainzProvider,
      itunes: itunesProvider,
      lastfm: lastfmProvider
    })

    // Clear initial metrics if any
    // (Instance is fresh from setupMocks)

    // 2. Simulate Burst Traffic (100 concurrent requests)
    const totalRequests = 100
    const promises = []

    for (let i = 0; i < totalRequests; i++) {
      promises.push(index.aggregateArtist(`Artist ${i}`))
    }

    const results = await Promise.allSettled(promises)

    // 3. Verify System State Under Load
    assert.equal(results.length, totalRequests, 'All requests should complete')

    // Check results stability
    let successfulResults = 0
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const data = result.value
        if (data.partial !== true) {
          console.log('Got partial=false:', JSON.stringify(data))
        }
        assert.equal(data.partial, true) // Always partial because "slow" always times out
        assert.ok(data.albums.length > 0)

        // Edge Case Verification: Schema validation
        if (data.partial !== true) {
          console.log('Got partial=false:', JSON.stringify(data))
        }
        assert.equal(data.partial, true) // Always partial because "slow" always times out
        for (const album of data.albums) {
          assert.ok(album.name)
          assert.ok(album.ids)
          assert.ok(album.ids.mb || album.ids.itunes)
          assert.equal(typeof album.provider, 'string')
        }
        successfulResults++
      }
    }

    assert.equal(successfulResults, totalRequests, 'No requests should reject at the aggregate level due to graceful fallback')

    // 4. Verify Metrics reflect the state correctly
    const stats = metrics.getStats()
    assert.equal(stats.aggregation.total, totalRequests, 'Metrics should capture all aggregation attempts')
    assert.equal(stats.aggregation.partial, totalRequests, 'All requests should be marked partial due to the slow provider')
    assert.equal(stats.aggregation.full, 0)
    assert.equal(stats.aggregation.empty, 0)

    // Verify provider metrics
    assert.ok(stats.providers.musicbrainz)
    assert.equal(stats.providers.musicbrainz.calls, totalRequests)

    assert.ok(stats.providers.lastfm)
    assert.equal(stats.providers.lastfm.calls, totalRequests)
    assert.equal(stats.providers.lastfm.timeouts, totalRequests, 'Slow provider should register timeouts for all calls')
  })
})

const test = require('node:test')
const assert = require('node:assert/strict')

function setupMocks (providersStr, providersMocks) {
  delete require.cache[require.resolve('../providers/index')]
  delete require.cache[require.resolve('../providers/safeProviderCall')]
  delete require.cache[require.resolve('../health/providerHealth')]
  delete require.cache[require.resolve('../health/providerMetrics')]

  require.cache[require.resolve('../settings/store')] = {
    exports: {
      getConfigValue: (key) => key === 'metadataProviders' ? providersStr : 'dummy'
    }
  }

  const metricsMock = { recordProviderCall: () => {}, recordLidarrAddShapeFailure: () => {} }
  require.cache[require.resolve('../metrics')] = { exports: metricsMock }

  require.cache[require.resolve('../utils/logger')] = {
    exports: { error: () => {}, warn: () => {}, info: () => {} }
  }

  require.cache[require.resolve('../providers/scoring')] = {
    exports: { getProviderScore: () => 0.8 } // Default score
  }

  for (const [name, mock] of Object.entries(providersMocks)) {
    try {
      require.cache[require.resolve(`../providers/${name}.provider`)] = { exports: mock }
    } catch {
      // For completely fake providers like 'failing_load'
      const path = require('path')
      require.cache[path.resolve(__dirname, `../providers/${name}.provider.js`)] = { exports: mock }
    }
  }

  const index = require('../providers/index')
  const { safeProviderCall } = require('../providers/safeProviderCall')
  const health = require('../health/providerHealth')
  const metrics = require('../health/providerMetrics')

  return { index, metricsMock, safeProviderCall, health, metrics }
}

test('Provider Resilience & Integration Hardening', async (t) => {
  await t.test('circuit-breaker trips under simulated load and skips subsequent calls', async () => {
    let callCount = 0
    const failingProvider = {
      name: 'failing_load',
      searchArtist: async () => {
        callCount++
        const err = new Error('simulated network failure')
        err.code = 'ECONNRESET'
        throw err
      }
    }

    const { safeProviderCall, health } = setupMocks('', { failing_load: failingProvider })
    health.reset()

    // FAILURE_THRESHOLD is 3 by default
    const loadCalls = 10
    const results = await Promise.allSettled(
      Array.from({ length: loadCalls }).map(() =>
        safeProviderCall('failing_load', failingProvider.searchArtist, 'Radiohead')
      )
    )

    // Verify it was actually called 3 times and then the circuit breaker opened for the rest
    // Wait, Promise.allSettled might execute concurrently and trigger multiple failures before
    // the threshold is reached or exceeded if they all fire at once.
    // Let's run them sequentially to guarantee state transitions.
    health.reset()
    callCount = 0
    const sequentialResults = []
    for (let i = 0; i < loadCalls; i++) {
      try {
        const res = await safeProviderCall('failing_load', failingProvider.searchArtist, 'Radiohead')
        sequentialResults.push({ status: 'fulfilled', value: res })
      } catch (err) {
        sequentialResults.push({ status: 'rejected', reason: err })
      }
    }

    assert.equal(callCount, 3, 'Provider should only be called exactly up to the failure threshold')
    
    // First 3 should throw the actual error, the rest should return null (skipped)
    for (let i = 0; i < 3; i++) {
      assert.equal(sequentialResults[i].status, 'rejected')
      assert.equal(sequentialResults[i].reason.message, 'simulated network failure')
    }
    for (let i = 3; i < loadCalls; i++) {
      assert.equal(sequentialResults[i].status, 'fulfilled')
      assert.equal(sequentialResults[i].value, null, 'Skipped call returns null')
    }
    
    assert.equal(health.get('failing_load').status, 'disabled')
  })

  await t.test('aggregateArtist handles partial failure (timeout) seamlessly', async () => {
    const successProvider = {
      name: 'musicbrainz',
      searchArtist: async () => ({ artistName: 'Radiohead', albums: [{ name: 'OK Computer' }] })
    }
    const timeoutProvider = {
      name: 'lastfm',
      searchArtist: async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        throw new Error('timeout')
      }
    }

    const { index, health } = setupMocks('musicbrainz,lastfm', {
      musicbrainz: successProvider,
      lastfm: timeoutProvider
    })
    health.reset()

    const result = await index.aggregateArtist('Radiohead')

    assert.equal(result.partial, true, 'Result should be marked partial due to lastfm timeout')
    assert.equal(result.providerCount, 1, 'Only 1 provider succeeded')
    assert.equal(result.artistName, 'Radiohead')
    assert.equal(result.albums.length, 1)
    
    assert.equal(health.get('musicbrainz').status, 'healthy')
    assert.equal(health.get('lastfm').failures, 1)
  })

  await t.test('aggregateArtist handles partial failure (malformed data)', async () => {
    const successProvider = {
      name: 'musicbrainz',
      searchArtist: async () => ({ artistName: 'Radiohead', albums: [{ name: 'OK Computer' }] })
    }
    const malformedProvider = {
      name: 'itunes',
      searchArtist: async () => ({ unexpected_key: 'junk_data' }) // Invalid shape
    }

    const { index, health } = setupMocks('musicbrainz,itunes', {
      musicbrainz: successProvider,
      itunes: malformedProvider
    })
    health.reset()

    const result = await index.aggregateArtist('Radiohead')

    assert.equal(result.partial, true)
    assert.equal(result.providerCount, 1)
    assert.equal(result.artistName, 'Radiohead')
    
    assert.equal(health.get('itunes').failures, 1, 'Malformed data should record a health failure')
  })

  await t.test('cross-provider merge logic waits for all and prefers scoring over speed', async () => {
    // Slow but high-score provider
    const slowHighScoring = {
      name: 'musicbrainz',
      searchArtist: async () => {
        await new Promise(resolve => setTimeout(resolve, 30))
        return { artistName: 'Radiohead', albums: [{ name: 'OK Computer', year: 1997, ids: { mb: '1' } }] }
      }
    }
    // Fast but low-score provider
    const fastLowScoring = {
      name: 'lastfm',
      searchArtist: async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        return { artistName: 'Radiohead', albums: [{ name: 'OK Computer', releaseDate: '1997-05-21', ids: { lfm: '2' } }] }
      }
    }

    const { index, health } = setupMocks('musicbrainz,lastfm', {
      musicbrainz: slowHighScoring,
      lastfm: fastLowScoring
    })
    
    // Force specific scores to ensure determinism regardless of metrics
    require.cache[require.resolve('../providers/scoring')] = {
      exports: { getProviderScore: (name) => name === 'musicbrainz' ? 0.95 : 0.5 }
    }
    health.reset()

    const result = await index.aggregateArtist('Radiohead')

    assert.equal(result.partial, false)
    assert.equal(result.providerCount, 2)
    assert.equal(result.albums.length, 1, 'Albums should merge into one')
    
    // musicbrainz score is higher, so its 'year' and ID identity should win if names match fuzzily
    assert.ok(result.albums[0].ids.mb)
    assert.ok(result.albums[0].ids.lfm)
    assert.equal(result.albums[0].year, 1997)
    assert.equal(result.albums[0].releaseDate, '1997-05-21', 'Should keep more precise date from fast provider')
  })
})

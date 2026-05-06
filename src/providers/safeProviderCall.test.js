const test = require('node:test')
const assert = require('node:assert/strict')

// Mock providerHealth and providerMetrics with controllable state so we
// can assert exactly what safeProviderCall recorded for each scenario.
function loadSafeCall ({ shouldUseValue = true, timeoutMs = 8000 } = {}) {
  const healthCalls = { recordSuccess: [], recordFailure: [] }
  const metricsCalls = []

  delete require.cache[require.resolve('./safeProviderCall')]
  require.cache[require.resolve('../health/providerHealth')] = {
    exports: {
      shouldUse: () => shouldUseValue,
      recordSuccess: (name) => { healthCalls.recordSuccess.push(name) },
      recordFailure: (name, err) => { healthCalls.recordFailure.push({ name, err }) }
    }
  }
  require.cache[require.resolve('../health/providerMetrics')] = {
    exports: {
      record: (name, success, latency) => { metricsCalls.push({ name, success, latency }) }
    }
  }
  require.cache[require.resolve('../settings/store')] = {
    exports: {
      getConfigValue: (key) => key === 'upstreamTimeoutMs' ? timeoutMs : undefined
    }
  }

  const { safeProviderCall } = require('./safeProviderCall')
  return { safeProviderCall, healthCalls, metricsCalls }
}

test('safeProviderCall — disabled provider is skipped without invoking fn', async () => {
  const { safeProviderCall, healthCalls, metricsCalls } = loadSafeCall({ shouldUseValue: false })
  let invoked = false
  const fn = async () => { invoked = true; return [] }

  const result = await safeProviderCall('mb', fn, 'q')
  assert.equal(result, null)
  assert.equal(invoked, false, 'fn must NOT be called when health says skip')
  assert.equal(healthCalls.recordSuccess.length, 0)
  assert.equal(healthCalls.recordFailure.length, 0)
  assert.equal(metricsCalls.length, 0, 'no metrics record on skip')
})

test('safeProviderCall — empty array is SUCCESS (finalized rule 2)', async () => {
  const { safeProviderCall, healthCalls, metricsCalls } = loadSafeCall()
  const result = await safeProviderCall('mb', async () => [], 'q')
  assert.deepEqual(result, [])
  assert.deepEqual(healthCalls.recordSuccess, ['mb'])
  assert.equal(healthCalls.recordFailure.length, 0)
  assert.equal(metricsCalls.length, 1)
  assert.equal(metricsCalls[0].success, true)
})

test('safeProviderCall — array with valid items returns filtered array', async () => {
  const { safeProviderCall, healthCalls } = loadSafeCall()
  const result = await safeProviderCall('mb', async () => [
    { artistName: 'A' },
    { albumName: 'X' },
    { title: 'T' },
    { junk: true } // dropped
  ], 'q')
  assert.equal(result.length, 3)
  assert.deepEqual(healthCalls.recordSuccess, ['mb'])
})

test('safeProviderCall — array with all-invalid items is INVALID SHAPE (failure)', async () => {
  const { safeProviderCall, healthCalls, metricsCalls } = loadSafeCall()
  await assert.rejects(
    safeProviderCall('mb', async () => [{ junk: 1 }, { other: 2 }], 'q'),
    (err) => err.code === 'INVALID_SHAPE'
  )
  assert.equal(healthCalls.recordFailure.length, 1)
  assert.equal(metricsCalls[0].success, false)
})

test('safeProviderCall — object with artistName is success (aggregateArtist contract)', async () => {
  const { safeProviderCall, healthCalls } = loadSafeCall()
  const result = await safeProviderCall('mb', async () => ({
    artistName: 'Radiohead',
    albums: [{ name: 'OK Computer' }]
  }), 'q')
  assert.equal(result.artistName, 'Radiohead')
  assert.deepEqual(healthCalls.recordSuccess, ['mb'])
})

test('safeProviderCall — object with only albums array is success', async () => {
  const { safeProviderCall, healthCalls } = loadSafeCall()
  const result = await safeProviderCall('mb', async () => ({ albums: [] }), 'q')
  assert.deepEqual(healthCalls.recordSuccess, ['mb'])
  assert.ok(result)
})

test('safeProviderCall — null/undefined result is INVALID SHAPE (failure)', async () => {
  const { safeProviderCall: sNull, healthCalls: hNull } = loadSafeCall()
  await assert.rejects(
    sNull('mb', async () => null, 'q'),
    (err) => err.code === 'INVALID_SHAPE'
  )
  assert.equal(hNull.recordFailure.length, 1)

  const { safeProviderCall: sUndef, healthCalls: hUndef } = loadSafeCall()
  await assert.rejects(
    sUndef('mb', async () => undefined, 'q'),
    (err) => err.code === 'INVALID_SHAPE'
  )
  assert.equal(hUndef.recordFailure.length, 1)
})

test('safeProviderCall — string/number result is INVALID SHAPE (failure)', async () => {
  const { safeProviderCall, healthCalls } = loadSafeCall()
  await assert.rejects(
    safeProviderCall('mb', async () => 'not an object', 'q'),
    (err) => err.code === 'INVALID_SHAPE'
  )
  assert.equal(healthCalls.recordFailure.length, 1)
})

test('safeProviderCall — exception is FAILURE and re-thrown to caller', async () => {
  const { safeProviderCall, healthCalls, metricsCalls } = loadSafeCall()
  const boom = async () => { throw new Error('upstream timeout') }
  await assert.rejects(
    safeProviderCall('mb', boom, 'q'),
    (err) => err.message === 'upstream timeout'
  )
  assert.equal(healthCalls.recordFailure.length, 1)
  assert.equal(healthCalls.recordFailure[0].err, 'upstream timeout')
  assert.equal(metricsCalls.length, 1)
  assert.equal(metricsCalls[0].success, false)
})

test('safeProviderCall — latency is recorded on every non-skipped path', async () => {
  // Success path
  {
    const { safeProviderCall, metricsCalls } = loadSafeCall()
    await safeProviderCall('mb', async () => [], 'q')
    assert.equal(metricsCalls.length, 1)
    assert.ok(metricsCalls[0].latency >= 0)
  }
  // Exception path
  {
    const { safeProviderCall, metricsCalls } = loadSafeCall()
    await assert.rejects(safeProviderCall('mb', async () => { throw new Error('x') }, 'q'))
    assert.equal(metricsCalls.length, 1)
    assert.ok(metricsCalls[0].latency >= 0)
  }
  // Invalid-shape path
  {
    const { safeProviderCall, metricsCalls } = loadSafeCall()
    await assert.rejects(safeProviderCall('mb', async () => null, 'q'))
    assert.equal(metricsCalls.length, 1)
    assert.ok(metricsCalls[0].latency >= 0)
  }
})

test('safeProviderCall — INVALID_SHAPE failure is recorded exactly once (no double-count)', async () => {
  const { safeProviderCall, healthCalls, metricsCalls } = loadSafeCall()
  await assert.rejects(safeProviderCall('mb', async () => null, 'q'))
  assert.equal(healthCalls.recordFailure.length, 1, 'health.recordFailure called exactly once')
  assert.equal(metricsCalls.length, 1, 'metrics.record called exactly once')
})

test('safeProviderCall — respects upstreamTimeoutMs config and times out', async () => {
  const { safeProviderCall, healthCalls, metricsCalls } = loadSafeCall({ timeoutMs: 50 })
  const slowFn = () => new Promise(resolve => setTimeout(() => resolve({ albums: [] }), 200))

  await assert.rejects(
    safeProviderCall('mb', slowFn, 'q'),
    (err) => err.code === 'ETIMEDOUT'
  )
  assert.equal(healthCalls.recordFailure.length, 1)
  assert.match(healthCalls.recordFailure[0].err, /timed out after 50ms/)
  assert.equal(metricsCalls.length, 1)
  assert.equal(metricsCalls[0].success, false)
})

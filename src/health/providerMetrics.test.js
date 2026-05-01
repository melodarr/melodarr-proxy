const test = require('node:test')
const assert = require('node:assert/strict')

const metrics = require('./providerMetrics')

function withFrozenNow (now, fn) {
  const original = Date.now
  Date.now = () => now
  try { return fn() } finally { Date.now = original }
}

test('providerMetrics — fresh provider has zero counters and zero score from data', () => {
  metrics.reset()
  const m = metrics.get('mb')
  assert.equal(m.success, 0)
  assert.equal(m.failure, 0)
  assert.equal(m.avgLatency, 0)
  assert.equal(m.lastSuccess, null)
  // computeScore for a never-called provider: successRate=0, latencyScore=1
  // (since avgLatency=0 → 1/(1+0)=1), freshnessScore=0 (no lastSuccess).
  // → 0*0.5 + 1*0.3 + 0*0.2 = 0.3
  assert.equal(metrics.computeScore(m), 0.3)
})

test('providerMetrics — record updates counters and EWMA', () => {
  metrics.reset()
  metrics.record('mb', true, 100)
  let m = metrics.get('mb')
  assert.equal(m.success, 1)
  assert.equal(m.avgLatency, 100, 'first sample seeds EWMA verbatim')

  metrics.record('mb', true, 300)
  m = metrics.get('mb')
  assert.equal(m.success, 2)
  // 100 * 0.7 + 300 * 0.3 = 70 + 90 = 160
  assert.equal(m.avgLatency, 160)
})

test('providerMetrics — failure increments only failure counter', () => {
  metrics.reset()
  metrics.record('mb', false, 5000)
  const m = metrics.get('mb')
  assert.equal(m.success, 0)
  assert.equal(m.failure, 1)
  assert.equal(m.lastSuccess, null)
})

test('providerMetrics — successRate dominates score ordering', () => {
  metrics.reset()
  // Provider A: 9 successes, 1 failure, latency 200ms
  for (let i = 0; i < 9; i++) metrics.record('a', true, 200)
  metrics.record('a', false, 200)
  // Provider B: 1 success, 9 failures, latency 200ms
  metrics.record('b', true, 200)
  for (let i = 0; i < 9; i++) metrics.record('b', false, 200)

  const sA = metrics.computeScore(metrics.get('a'))
  const sB = metrics.computeScore(metrics.get('b'))
  assert.ok(sA > sB, `success rate must dominate: A=${sA} B=${sB}`)
})

test('providerMetrics — latency reorders providers with equal success rate', () => {
  metrics.reset()
  // Both 100% success, but A is fast (50ms) and B is slow (5000ms).
  for (let i = 0; i < 5; i++) metrics.record('fast', true, 50)
  for (let i = 0; i < 5; i++) metrics.record('slow', true, 5000)

  const sFast = metrics.computeScore(metrics.get('fast'))
  const sSlow = metrics.computeScore(metrics.get('slow'))
  assert.ok(sFast > sSlow, `latency must reorder: fast=${sFast} slow=${sSlow}`)
})

test('providerMetrics — freshnessScore decays linearly over horizon', () => {
  metrics.reset()
  withFrozenNow(1_000_000_000, () => {
    metrics.record('mb', true, 100)
  })

  // Immediately after: freshness ≈ 1
  withFrozenNow(1_000_000_000, () => {
    const m = metrics.get('mb')
    assert.ok(m.lastSuccess !== null)
    const score = metrics.computeScore(m)
    // successRate=1*0.5 + latencyScore=1/(1.1)*0.3 + freshness=1*0.2
    // = 0.5 + 0.272... + 0.2 = ~0.972
    assert.ok(score > 0.9, `fresh score should be high: ${score}`)
  })

  // Halfway through horizon (5 min) → freshness ≈ 0.5
  withFrozenNow(1_000_000_000 + (5 * 60 * 1000), () => {
    const score = metrics.computeScore(metrics.get('mb'))
    // 0.5 + 0.272 + 0.1 = ~0.872
    assert.ok(score > 0.85 && score < 0.9, `mid-horizon score should be ~0.87: ${score}`)
  })

  // Past horizon → freshness = 0
  withFrozenNow(1_000_000_000 + (15 * 60 * 1000), () => {
    const score = metrics.computeScore(metrics.get('mb'))
    // 0.5 + 0.272 + 0 = ~0.772
    assert.ok(score > 0.75 && score < 0.8, `stale score should be ~0.77: ${score}`)
  })
})

test('providerMetrics — computeScore handles null/undefined safely', () => {
  assert.equal(metrics.computeScore(null), 0)
  assert.equal(metrics.computeScore(undefined), 0)
})

test('providerMetrics — get is lazy and idempotent', () => {
  metrics.reset()
  const m1 = metrics.get('mb')
  const m2 = metrics.get('mb')
  assert.equal(m1, m2, 'returns the same reference')
})

test('providerMetrics — sortByScore orders providers by computed score (desc)', () => {
  metrics.reset()
  // 'fast' wins on latency; 'slow' has same successRate but worse latency.
  for (let i = 0; i < 5; i++) metrics.record('fast', true, 50)
  for (let i = 0; i < 5; i++) metrics.record('slow', true, 5000)
  // 'unreliable' has bad successRate.
  metrics.record('unreliable', true, 100)
  for (let i = 0; i < 9; i++) metrics.record('unreliable', false, 100)

  const sorted = metrics.sortByScore([
    { name: 'slow' }, { name: 'unreliable' }, { name: 'fast' }
  ])
  assert.deepEqual(sorted.map((p) => p.name), ['fast', 'slow', 'unreliable'])
})

test('providerMetrics — sortByScore handles empty input', () => {
  metrics.reset()
  assert.deepEqual(metrics.sortByScore([]), [])
})

test('providerMetrics — sortByScore preserves arbitrary item shape', () => {
  metrics.reset()
  metrics.record('a', true, 100)
  const sorted = metrics.sortByScore([
    { name: 'a', extra: 'payload', searchArtist: () => {} }
  ])
  assert.equal(sorted[0].extra, 'payload')
  assert.equal(typeof sorted[0].searchArtist, 'function')
})

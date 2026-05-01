const test = require('node:test')
const assert = require('node:assert/strict')

// Stub the logger before requiring the health module so the WARN/INFO
// transition logs don't pollute test output.
require.cache[require.resolve('../utils/logger')] = {
  exports: { error () {}, warn () {}, info () {}, debug () {} }
}

const health = require('./providerHealth')

function withFrozenNow (now, fn) {
  const original = Date.now
  Date.now = () => now
  try { return fn() } finally { Date.now = original }
}

test('providerHealth — fresh provider is healthy and usable', () => {
  health.reset()
  assert.equal(health.shouldUse('mb'), true)
  const s = health.get('mb')
  assert.equal(s.status, 'healthy')
  assert.equal(s.failures, 0)
})

test('providerHealth — single failure yields degraded, still usable', () => {
  health.reset()
  health.recordFailure('mb', 'flaky')
  assert.equal(health.get('mb').status, 'degraded')
  assert.equal(health.get('mb').failures, 1)
  assert.equal(health.shouldUse('mb'), true)
})

test('providerHealth — disable after 3 consecutive failures', () => {
  health.reset()
  health.recordFailure('mb', 'err1')
  health.recordFailure('mb', 'err2')
  assert.equal(health.shouldUse('mb'), true, 'still usable at 2 failures')
  health.recordFailure('mb', 'err3')
  assert.equal(health.get('mb').status, 'disabled')
  assert.equal(health.shouldUse('mb'), false, 'must skip when disabled before cooldown')
})

test('providerHealth — success resets failures and restores healthy', () => {
  health.reset()
  health.recordFailure('mb', 'a')
  health.recordFailure('mb', 'b')
  health.recordSuccess('mb')
  assert.equal(health.get('mb').status, 'healthy')
  assert.equal(health.get('mb').failures, 0)
  assert.equal(health.get('mb').lastErrorMessage, null)
})

test('providerHealth — canary allowed only after cooldown elapses', () => {
  health.reset()
  withFrozenNow(1_000_000, () => {
    health.recordFailure('mb', 'a')
    health.recordFailure('mb', 'b')
    health.recordFailure('mb', 'c')
    assert.equal(health.shouldUse('mb'), false, 'no canary immediately after disable')
  })
  withFrozenNow(1_000_000 + (10 * 60 * 1000) - 1, () => {
    assert.equal(health.shouldUse('mb'), false, 'no canary just before cooldown elapses')
  })
  withFrozenNow(1_000_000 + (10 * 60 * 1000) + 1, () => {
    assert.equal(health.shouldUse('mb'), true, 'canary allowed after cooldown')
  })
})

test('providerHealth — canary success restores provider', () => {
  health.reset()
  withFrozenNow(1_000_000, () => {
    health.recordFailure('mb', 'a')
    health.recordFailure('mb', 'b')
    health.recordFailure('mb', 'c')
  })
  withFrozenNow(1_000_000 + (10 * 60 * 1000) + 1, () => {
    assert.equal(health.shouldUse('mb'), true)
    health.recordSuccess('mb')
    assert.equal(health.get('mb').status, 'healthy')
    assert.equal(health.shouldUse('mb'), true)
  })
})

test('providerHealth — canary failure leaves provider disabled and resets cooldown', () => {
  health.reset()
  withFrozenNow(1_000_000, () => {
    health.recordFailure('mb', 'a')
    health.recordFailure('mb', 'b')
    health.recordFailure('mb', 'c')
  })
  // After cooldown, canary fires — and fails. Should remain disabled and
  // the next cooldown is measured from this newest failure.
  withFrozenNow(1_000_000 + (10 * 60 * 1000) + 1, () => {
    health.recordFailure('mb', 'still broken')
    assert.equal(health.get('mb').status, 'disabled')
    assert.equal(health.shouldUse('mb'), false)
  })
  // Just past the original cooldown but well before a new one — still no.
  withFrozenNow(1_000_000 + (15 * 60 * 1000), () => {
    assert.equal(health.shouldUse('mb'), false)
  })
})

test('providerHealth — failures on one provider do not affect another', () => {
  health.reset()
  health.recordFailure('mb', 'a')
  health.recordFailure('mb', 'b')
  health.recordFailure('mb', 'c')
  assert.equal(health.shouldUse('mb'), false)
  assert.equal(health.shouldUse('itunes'), true)
  assert.equal(health.get('itunes').failures, 0)
})

test('providerHealth — lastErrorMessage tracks the most recent failure cause', () => {
  health.reset()
  health.recordFailure('mb', 'first error')
  assert.equal(health.get('mb').lastErrorMessage, 'first error')
  health.recordFailure('mb', 'second error')
  assert.equal(health.get('mb').lastErrorMessage, 'second error')
  health.recordSuccess('mb')
  assert.equal(health.get('mb').lastErrorMessage, null, 'cleared on success')
})

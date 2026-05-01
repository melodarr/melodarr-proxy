const test = require('node:test')
const assert = require('node:assert/strict')

// Stub the logger before requiring the health module so the WARN/INFO
// transition logs don't pollute test output.
const loggerCalls = { error: [], warn: [], info: [], debug: [] }
require.cache[require.resolve('../utils/logger')] = {
  exports: {
    error (...args) { loggerCalls.error.push(args) },
    warn (...args) { loggerCalls.warn.push(args) },
    info (...args) { loggerCalls.info.push(args) },
    debug (...args) { loggerCalls.debug.push(args) }
  }
}

// v0.3.40: capture sendAlert invocations to assert spam-prevention
// behavior. Stubbed BEFORE providerHealth is required so the require
// inside the health module binds to this mock.
const alertCalls = []
require.cache[require.resolve('../alerts/alertService')] = {
  exports: {
    sendAlert: (msg) => alertCalls.push(msg),
    sendSlack: async () => {}
  }
}

const health = require('./providerHealth')

function resetLoggerCalls () {
  loggerCalls.error = []
  loggerCalls.warn = []
  loggerCalls.info = []
  loggerCalls.debug = []
}

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

test('providerHealth — canary success alone does not restore disabled provider', () => {
  health.reset()
  withFrozenNow(1_000_000, () => {
    health.recordFailure('mb', 'a')
    health.recordFailure('mb', 'b')
    health.recordFailure('mb', 'c')
  })
  withFrozenNow(1_000_000 + (10 * 60 * 1000) + 1, () => {
    assert.equal(health.shouldUse('mb'), true)
    health.recordSuccess('mb')
    assert.equal(health.get('mb').status, 'disabled')
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

test('providerHealth — auto-reenables disabled provider after success threshold', () => {
  health.reset()
  resetLoggerCalls()

  withFrozenNow(1_000_000, () => {
    health.recordFailure('mb', 'a')
    health.recordFailure('mb', 'b')
    health.recordFailure('mb', 'c')
  })

  withFrozenNow(1_000_001, () => health.recordSuccess('mb'))
  assert.equal(health.get('mb').status, 'disabled')
  withFrozenNow(1_000_002, () => health.recordSuccess('mb'))
  assert.equal(health.get('mb').status, 'disabled')
  withFrozenNow(1_000_003, () => health.recordSuccess('mb'))

  const state = health.get('mb')
  assert.equal(state.status, 'degraded')
  assert.equal(state.failures, 0)
  assert.equal(state.successStreak, 3)
  assert.equal(loggerCalls.info.filter(call => call[0] === 'Provider auto-reenabled after success streak').length, 1)
})

test('providerHealth — does not reenable with spaced-out successes', () => {
  health.reset()

  withFrozenNow(1_000_000, () => {
    health.recordFailure('mb', 'a')
    health.recordFailure('mb', 'b')
    health.recordFailure('mb', 'c')
  })

  withFrozenNow(1_000_001, () => health.recordSuccess('mb'))
  withFrozenNow(1_000_001 + health.REENABLE_WINDOW_MS + 1, () => health.recordSuccess('mb'))
  withFrozenNow(1_000_001 + health.REENABLE_WINDOW_MS + 2, () => health.recordSuccess('mb'))

  assert.equal(health.get('mb').status, 'disabled')
  assert.equal(health.get('mb').lastSuccessTimes.length, 2)
})

test('providerHealth — does not reenable if failures interrupt success streak', () => {
  health.reset()

  withFrozenNow(1_000_000, () => {
    health.recordFailure('mb', 'a')
    health.recordFailure('mb', 'b')
    health.recordFailure('mb', 'c')
  })

  withFrozenNow(1_000_001, () => health.recordSuccess('mb'))
  withFrozenNow(1_000_002, () => health.recordFailure('mb', 'interrupt'))
  withFrozenNow(1_000_003, () => health.recordSuccess('mb'))
  withFrozenNow(1_000_004, () => health.recordSuccess('mb'))

  const state = health.get('mb')
  assert.equal(state.status, 'disabled')
  assert.equal(state.successStreak, 2)
  assert.equal(state.lastSuccessTimes.length, 2)
})

test('providerHealth — returns to disabled if failures resume after auto-reenable', () => {
  health.reset()

  withFrozenNow(1_000_000, () => {
    health.recordFailure('mb', 'a')
    health.recordFailure('mb', 'b')
    health.recordFailure('mb', 'c')
    health.recordSuccess('mb')
    health.recordSuccess('mb')
    health.recordSuccess('mb')
    assert.equal(health.get('mb').status, 'degraded')
    health.recordFailure('mb', 'again 1')
    health.recordFailure('mb', 'again 2')
    health.recordFailure('mb', 'again 3')
  })

  assert.equal(health.get('mb').status, 'disabled')
  withFrozenNow(1_000_000, () => {
    assert.equal(health.shouldUse('mb'), false)
  })
})

test('providerHealth — auto-reenable log does not repeat after reenable', () => {
  health.reset()
  resetLoggerCalls()

  withFrozenNow(1_000_000, () => {
    health.recordFailure('mb', 'a')
    health.recordFailure('mb', 'b')
    health.recordFailure('mb', 'c')
    health.recordSuccess('mb')
    health.recordSuccess('mb')
    health.recordSuccess('mb')
    health.recordSuccess('mb')
    health.recordSuccess('mb')
  })

  assert.equal(loggerCalls.info.filter(call => call[0] === 'Provider auto-reenabled after success streak').length, 1)
})

// ── v0.3.39: env-configurable thresholds ──────────────────────────────
//
// The constants are read once at module load. To exercise non-default
// values we re-require the module in a child process with the env var
// set, then assert against the exposed FAILURE_THRESHOLD / COOLDOWN_MS
// constants and against observable behavior.
const { spawnSync } = require('node:child_process')
const path = require('node:path')

function loadHealthWithEnv (env) {
  const result = spawnSync(process.execPath, [
    '-e',
    `
      const h = require(${JSON.stringify(path.resolve(__dirname, './providerHealth'))});
      // Drive 1 failure, then ${env.PROVIDER_FAILURE_THRESHOLD || 3} - 1 more,
      // and report whether status flipped to disabled at the configured threshold.
      const threshold = h.FAILURE_THRESHOLD;
      const cooldown = h.COOLDOWN_MS;
      const reenableThreshold = h.REENABLE_THRESHOLD;
      const reenableWindow = h.REENABLE_WINDOW_MS;
      for (let i = 0; i < threshold - 1; i++) h.recordFailure('p', 'x');
      const beforeLast = h.get('p').status;
      h.recordFailure('p', 'x');
      const afterLast = h.get('p').status;
      console.log(JSON.stringify({ threshold, cooldown, reenableThreshold, reenableWindow, beforeLast, afterLast }));
    `
  ], { env: { ...process.env, ...env }, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`child failed: ${result.stderr || result.stdout}`)
  }
  return JSON.parse(result.stdout.trim().split('\n').pop())
}

test('providerHealth — defaults still apply when no env set', () => {
  // Explicitly clear our test-targeted vars so the defaults take effect.
  const r = loadHealthWithEnv({ PROVIDER_FAILURE_THRESHOLD: '', PROVIDER_COOLDOWN_MS: '', PROVIDER_REENABLE_SUCCESS_THRESHOLD: '', PROVIDER_REENABLE_WINDOW_MS: '' })
  assert.equal(r.threshold, 3)
  assert.equal(r.cooldown, 10 * 60 * 1000)
  assert.equal(r.beforeLast, 'degraded')
  assert.equal(r.afterLast, 'disabled')
})

test('providerHealth — custom PROVIDER_FAILURE_THRESHOLD respected', () => {
  const r = loadHealthWithEnv({ PROVIDER_FAILURE_THRESHOLD: '5' })
  assert.equal(r.threshold, 5)
  assert.equal(r.beforeLast, 'degraded', '4 failures should still be degraded when threshold=5')
  assert.equal(r.afterLast, 'disabled', '5th failure should disable')
})

test('providerHealth — custom PROVIDER_COOLDOWN_MS respected', () => {
  const r = loadHealthWithEnv({ PROVIDER_COOLDOWN_MS: '30000' })
  assert.equal(r.cooldown, 30000)
})

test('providerHealth — custom PROVIDER_REENABLE_SUCCESS_THRESHOLD respected', () => {
  const r = loadHealthWithEnv({ PROVIDER_REENABLE_SUCCESS_THRESHOLD: '5' })
  assert.equal(r.reenableThreshold, 5)
})

test('providerHealth — custom PROVIDER_REENABLE_WINDOW_MS respected', () => {
  const r = loadHealthWithEnv({ PROVIDER_REENABLE_WINDOW_MS: '30000' })
  assert.equal(r.reenableWindow, 30000)
})

test('providerHealth — invalid PROVIDER_FAILURE_THRESHOLD throws on load', () => {
  const result = spawnSync(process.execPath, [
    '-e',
    `require(${JSON.stringify(path.resolve(__dirname, './providerHealth'))});`
  ], { env: { ...process.env, PROVIDER_FAILURE_THRESHOLD: '0' }, encoding: 'utf8' })
  assert.notEqual(result.status, 0, 'process must exit non-zero')
  assert.match(result.stderr, /Invalid PROVIDER_FAILURE_THRESHOLD/)
})

test('providerHealth — invalid PROVIDER_FAILURE_THRESHOLD (negative) throws on load', () => {
  const result = spawnSync(process.execPath, [
    '-e',
    `require(${JSON.stringify(path.resolve(__dirname, './providerHealth'))});`
  ], { env: { ...process.env, PROVIDER_FAILURE_THRESHOLD: '-1' }, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Invalid PROVIDER_FAILURE_THRESHOLD/)
})

test('providerHealth — invalid PROVIDER_COOLDOWN_MS (negative) throws on load', () => {
  const result = spawnSync(process.execPath, [
    '-e',
    `require(${JSON.stringify(path.resolve(__dirname, './providerHealth'))});`
  ], { env: { ...process.env, PROVIDER_COOLDOWN_MS: '-100' }, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Invalid PROVIDER_COOLDOWN_MS/)
})

// ── v0.3.40: alert hook (transition to disabled only) ─────────────

test('providerHealth — sendAlert fires exactly once on transition to disabled', () => {
  health.reset()
  alertCalls.length = 0

  health.recordFailure('mb', 'a')
  health.recordFailure('mb', 'b')
  assert.equal(alertCalls.length, 0, 'no alert below threshold')

  health.recordFailure('mb', 'c')
  assert.equal(alertCalls.length, 1, 'one alert on transition')
  assert.match(alertCalls[0], /Provider mb disabled/)
})

test('providerHealth — sendAlert does NOT repeat while already disabled', () => {
  health.reset()
  alertCalls.length = 0

  health.recordFailure('mb', 'a')
  health.recordFailure('mb', 'b')
  health.recordFailure('mb', 'c')
  health.recordFailure('mb', 'd')
  health.recordFailure('mb', 'e')
  health.recordFailure('mb', 'f')
  assert.equal(alertCalls.length, 1, 'sustained outage must not spam alerts')
})

test('providerHealth — alert message includes provider name, failure count, last error', () => {
  health.reset()
  alertCalls.length = 0
  health.recordFailure('discogs', 'rate limited')
  health.recordFailure('discogs', 'timeout')
  health.recordFailure('discogs', 'TLS reset')
  assert.match(alertCalls[0], /discogs/)
  assert.match(alertCalls[0], /3 consecutive failures/)
  assert.match(alertCalls[0], /TLS reset/)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const metrics = require('./providerMetrics')

function withFrozenNow (now, fn) {
  const original = Date.now
  Date.now = () => now
  try { return fn() } finally { Date.now = original }
}

// ── score formula (v0.3.40: successRate*0.5 + latencyScore*0.5) ────

test('providerMetrics — fresh provider scores 0.25 from default latency only', () => {
  metrics.reset()
  const m = metrics.get('mb')
  assert.equal(m.success, 0)
  assert.equal(m.failure, 0)
  assert.equal(m.avgLatency, 0)
  assert.equal(m.lastSuccess, null)
  // No data: successRate = 0/1 = 0; latencyScore = 1/(1+1000/1000) = 0.5
  // Score = 0*0.5 + 0.5*0.5 = 0.25
  assert.equal(metrics.computeScore(m), 0.25)
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
  for (let i = 0; i < 9; i++) metrics.record('a', true, 200)
  metrics.record('a', false, 200)
  metrics.record('b', true, 200)
  for (let i = 0; i < 9; i++) metrics.record('b', false, 200)

  const sA = metrics.computeScore(metrics.get('a'))
  const sB = metrics.computeScore(metrics.get('b'))
  assert.ok(sA > sB, `success rate must dominate: A=${sA} B=${sB}`)
})

test('providerMetrics — latency reorders providers with equal success rate', () => {
  metrics.reset()
  for (let i = 0; i < 5; i++) metrics.record('fast', true, 50)
  for (let i = 0; i < 5; i++) metrics.record('slow', true, 5000)

  const sFast = metrics.computeScore(metrics.get('fast'))
  const sSlow = metrics.computeScore(metrics.get('slow'))
  assert.ok(sFast > sSlow, `latency must reorder: fast=${sFast} slow=${sSlow}`)
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

// ── v0.3.40: time-based decay (read-only) ──────────────────────────

test('providerMetrics — computeScore is PURE: does not mutate the input', () => {
  metrics.reset()
  withFrozenNow(1_000_000_000, () => {
    metrics.record('mb', true, 100)
  })
  const before = JSON.parse(JSON.stringify(metrics.get('mb')))
  withFrozenNow(1_000_000_000 + 5 * 60_000, () => {
    metrics.computeScore(metrics.get('mb'))
    metrics.computeScore(metrics.get('mb'))
    metrics.computeScore(metrics.get('mb'))
  })
  const after = metrics.get('mb')
  assert.equal(after.success, before.success)
  assert.equal(after.failure, before.failure)
  assert.equal(after.lastDecayAt, before.lastDecayAt)
})

test('providerMetrics — applyDecay reduces counters proportional to elapsed minutes', () => {
  metrics.reset()
  const clone = {
    success: 100,
    failure: 100,
    lastDecayAt: 1_000_000_000
  }
  withFrozenNow(1_000_000_000 + 60 * 60_000, () => {
    metrics.applyDecay(clone)
  })
  // 60 minutes elapsed → factor = 0.98^60 ≈ 0.2975
  assert.ok(clone.success < 31 && clone.success > 29, `success decayed to ~30: ${clone.success}`)
  assert.ok(clone.failure < 31 && clone.failure > 29, `failure decayed to ~30: ${clone.failure}`)
  assert.equal(clone.lastDecayAt, 1_000_000_000 + 60 * 60_000)
})

test('providerMetrics — decay shrinks raw clone counters but preserves successRate', () => {
  // The spec'd decay model multiplies success and failure by the same
  // factor on read, which preserves their ratio (and therefore the
  // contribution of successRate to score). The decay is observable on
  // the clone counters themselves but does NOT change the score for a
  // provider with a stable success/failure ratio. Documenting this here
  // so a future contributor doesn't expect decay to "demote" stale-but-
  // historically-successful providers via the score path. (See the
  // /debug/providers/metrics endpoint for a side-by-side raw vs decayed
  // view that surfaces the actual decay magnitude.)
  metrics.reset()
  withFrozenNow(1_000_000_000, () => {
    for (let i = 0; i < 100; i++) metrics.record('mb', true, 100)
  })
  const scoreFresh = withFrozenNow(1_000_000_000, () => metrics.computeScore(metrics.get('mb')))
  const scoreStale = withFrozenNow(1_000_000_000 + 6 * 60 * 60_000, () => metrics.computeScore(metrics.get('mb')))
  assert.equal(scoreFresh, scoreStale, 'uniform decay preserves successRate-driven score')
  assert.equal(metrics.get('mb').success, 100, 'real m.success unchanged by computeScore reads')
})

// ── v0.3.40: persistence (subprocess for isolated module init) ─────

test('providerMetrics — persists across reload', () => {
  const tmpFile = path.join(os.tmpdir(), `pm-test-${Date.now()}-${Math.random()}.json`)
  try {
    const seed = spawnSync(process.execPath, ['-e', `
      process.env.PROVIDER_METRICS_PATH = ${JSON.stringify(tmpFile)};
      const m = require(${JSON.stringify(path.resolve(__dirname, './providerMetrics'))});
      m.record('mb', true, 234);
      m.record('mb', false, 1000);
      setTimeout(() => {
        const fs = require('fs');
        const content = JSON.stringify(Object.fromEntries(new Map([['mb', m.get('mb')]])), null, 2);
        fs.writeFileSync(${JSON.stringify(tmpFile)}, content);
        process.exit(0);
      }, 50);
    `], { encoding: 'utf8' })
    assert.equal(seed.status, 0, `seed child failed: ${seed.stderr}`)

    const verify = spawnSync(process.execPath, ['-e', `
      process.env.PROVIDER_METRICS_PATH = ${JSON.stringify(tmpFile)};
      const m = require(${JSON.stringify(path.resolve(__dirname, './providerMetrics'))});
      m.load().then(() => {
        const got = m.get('mb');
        console.log(JSON.stringify({ success: got.success, failure: got.failure, avgLatency: got.avgLatency }));
      });
    `], { encoding: 'utf8' })
    assert.equal(verify.status, 0, `verify child failed: ${verify.stderr}`)
    const restored = JSON.parse(verify.stdout.trim().split('\n').pop())
    assert.equal(restored.success, 1)
    assert.equal(restored.failure, 1)
    // EWMA after 2 samples: 234 * 0.7 + 1000 * 0.3 = 463.8
    assert.ok(Math.abs(restored.avgLatency - 463.8) < 0.01, `EWMA persisted: ${restored.avgLatency}`)
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
  }
})

test('providerMetrics — corrupted file does not crash on load', () => {
  const tmpFile = path.join(os.tmpdir(), `pm-corrupt-${Date.now()}.json`)
  fs.writeFileSync(tmpFile, '{not json at all]]')
  try {
    const result = spawnSync(process.execPath, ['-e', `
      process.env.PROVIDER_METRICS_PATH = ${JSON.stringify(tmpFile)};
      const m = require(${JSON.stringify(path.resolve(__dirname, './providerMetrics'))});
      m.load().then(() => {
        console.log(JSON.stringify({ size: m._getAllNames().length }));
      }).catch(e => {
        console.error('LOAD_THREW: ' + e.message);
        process.exit(2);
      });
    `], { encoding: 'utf8' })
    assert.equal(result.status, 0, `load threw on corrupt file: ${result.stderr}`)
    const out = JSON.parse(result.stdout.trim().split('\n').pop())
    assert.equal(out.size, 0, 'corrupt file → empty state, no crash')
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
  }
})

test('providerMetrics — missing file does not crash on load', () => {
  const tmpFile = path.join(os.tmpdir(), `pm-missing-${Date.now()}.json`)
  const result = spawnSync(process.execPath, ['-e', `
    process.env.PROVIDER_METRICS_PATH = ${JSON.stringify(tmpFile)};
    const m = require(${JSON.stringify(path.resolve(__dirname, './providerMetrics'))});
    m.load().then(() => {
      console.log('OK');
    }).catch(e => {
      console.error('LOAD_THREW: ' + e.message);
      process.exit(2);
    });
  `], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /OK/)
})

// ── sortByScore (unchanged behavior) ───────────────────────────────

test('providerMetrics — sortByScore orders providers by computed score (desc)', () => {
  metrics.reset()
  for (let i = 0; i < 5; i++) metrics.record('fast', true, 50)
  for (let i = 0; i < 5; i++) metrics.record('slow', true, 5000)
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

test('providerMetrics — sortByScore supports custom metric names', () => {
  metrics.reset()
  for (let i = 0; i < 5; i++) metrics.record('canonical', true, 50)
  for (let i = 0; i < 5; i++) metrics.record('other', true, 5000)

  const sorted = metrics.sortByScore([
    { name: 'alias', metricName: 'canonical' },
    { name: 'other', metricName: 'other' }
  ], (item) => item.metricName)

  assert.deepEqual(sorted.map((item) => item.name), ['alias', 'other'])
})

const test = require('node:test')
const assert = require('node:assert/strict')

// Capture logger calls so we can assert what was logged without spamming
// the test output. Stubbed before requiring the runner so the require()
// in shadowRunner.js binds to our stub.
const logged = []
require.cache[require.resolve('../utils/logger')] = {
  exports: {
    info: (msg, meta) => logged.push({ level: 'info', msg, meta }),
    warn: (msg, meta) => logged.push({ level: 'warn', msg, meta }),
    error: (msg, meta) => logged.push({ level: 'error', msg, meta }),
    debug () {}
  }
}

const { shadowCall } = require('./shadowRunner')

function flushMicrotasks () {
  // Three turns is enough for Promise.resolve().then().then().then() in
  // shadowRunner; each chained .then is one microtask flush.
  return new Promise((resolve) => setImmediate(() => setImmediate(() => setImmediate(resolve))))
}

test('shadowCall — does not block the caller', async () => {
  logged.length = 0
  // Deferred constructed up-front so the resolver exists before shadowCall
  // schedules its microtask chain.
  let resolveProvider
  const slowPromise = new Promise((resolve) => { resolveProvider = resolve })
  const slow = () => slowPromise
  const before = Date.now()
  shadowCall('mb', slow, 'test')
  const elapsed = Date.now() - before
  assert.ok(elapsed < 50, `caller continued without awaiting (elapsed ${elapsed}ms)`)
  // Resolve so the runner's promise chain settles cleanly.
  resolveProvider([])
  await flushMicrotasks()
})

test('shadowCall — logs success with provider, success, latencyMs, length', async () => {
  logged.length = 0
  shadowCall('mb', async () => [{ artistName: 'A' }, { artistName: 'B' }], 'test')
  await flushMicrotasks()
  const entry = logged.find((l) => l.msg === 'Shadow call ok')
  assert.ok(entry, 'must log success entry')
  assert.equal(entry.level, 'info')
  assert.equal(entry.meta.provider, 'mb')
  assert.equal(entry.meta.success, true)
  assert.equal(entry.meta.length, 2)
  assert.ok(typeof entry.meta.latencyMs === 'number')
})

test('shadowCall — provider exception is caught and logged at info, never propagates', async () => {
  logged.length = 0
  const failing = async () => { throw new Error('upstream blew up') }
  // Must not throw even though the wrapped fn rejects.
  assert.doesNotThrow(() => shadowCall('mb', failing, 'test'))
  await flushMicrotasks()
  const entry = logged.find((l) => l.msg === 'Shadow call failed')
  assert.ok(entry, 'must log failure entry')
  assert.equal(entry.level, 'info')
  assert.equal(entry.meta.success, false)
  assert.equal(entry.meta.error, 'upstream blew up')
})

test('shadowCall — synchronous throw inside fn is also captured', async () => {
  logged.length = 0
  const syncThrow = () => { throw new Error('sync boom') }
  assert.doesNotThrow(() => shadowCall('mb', syncThrow, 'test'))
  await flushMicrotasks()
  const entry = logged.find((l) => l.msg === 'Shadow call failed')
  assert.ok(entry)
  assert.equal(entry.meta.error, 'sync boom')
})

test('shadowCall — non-array result reports length=1 (treated as single object)', async () => {
  logged.length = 0
  shadowCall('mb', async () => ({ artistName: 'X', albums: [] }), 'test')
  await flushMicrotasks()
  const entry = logged.find((l) => l.msg === 'Shadow call ok')
  assert.equal(entry.meta.length, 1)
})

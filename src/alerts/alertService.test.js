const test = require('node:test')
const assert = require('node:assert/strict')

// Capture logger.warn calls so we can assert what was logged.
const logged = []
require.cache[require.resolve('../utils/logger')] = {
  exports: {
    info () {},
    warn: (msg, meta) => logged.push({ msg, meta }),
    error () {},
    debug () {}
  }
}

const { sendAlert, sendSlack } = require('./alertService')

function withFetch (impl, fn) {
  const orig = global.fetch
  global.fetch = impl
  try { return fn() } finally { global.fetch = orig }
}

function withEnv (vars, fn) {
  const orig = {}
  for (const [k, v] of Object.entries(vars)) {
    orig[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try { return fn() } finally {
    for (const [k, v] of Object.entries(orig)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

const flush = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)))

test('sendSlack — no-op when ALERT_SLACK_WEBHOOK is unset', async () => {
  let called = false
  await withEnv({ ALERT_SLACK_WEBHOOK: undefined }, async () => {
    await withFetch(async () => { called = true }, async () => {
      await sendSlack('hello')
    })
  })
  assert.equal(called, false, 'fetch must not be called without webhook env')
})

test('sendSlack — POSTs JSON payload with text field when webhook is set', async () => {
  const captured = {}
  await withEnv({ ALERT_SLACK_WEBHOOK: 'https://hooks.slack.test/xyz' }, async () => {
    await withFetch(async (url, opts) => {
      captured.url = url
      captured.method = opts.method
      captured.headers = opts.headers
      captured.body = opts.body
      return { ok: true, status: 200 }
    }, async () => {
      await sendSlack('hello world')
    })
  })
  assert.equal(captured.url, 'https://hooks.slack.test/xyz')
  assert.equal(captured.method, 'POST')
  assert.equal(captured.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(captured.body), { text: 'hello world' })
})

test('sendSlack — logs warn on non-2xx response', async () => {
  logged.length = 0
  await withEnv({ ALERT_SLACK_WEBHOOK: 'https://hooks.slack.test/xyz' }, async () => {
    await withFetch(async () => ({ ok: false, status: 429 }), async () => {
      await sendSlack('rate-limited test')
    })
  })
  const entry = logged.find((l) => l.msg === 'Slack alert HTTP error')
  assert.ok(entry, 'must log HTTP error')
  assert.equal(entry.meta.status, 429)
})

test('sendSlack — logs warn on fetch network error, never throws', async () => {
  logged.length = 0
  await withEnv({ ALERT_SLACK_WEBHOOK: 'https://hooks.slack.test/xyz' }, async () => {
    await withFetch(async () => { throw new Error('ENOTFOUND') }, async () => {
      await sendSlack('network test')
    })
  })
  const entry = logged.find((l) => l.msg === 'Slack alert failed')
  assert.ok(entry, 'must log network error')
  assert.equal(entry.meta.error, 'ENOTFOUND')
})

test('sendAlert — fire-and-forget: never blocks, never rejects', async () => {
  await withEnv({ ALERT_SLACK_WEBHOOK: 'https://hooks.slack.test/xyz' }, async () => {
    await withFetch(async () => { throw new Error('boom') }, async () => {
      // sendAlert is sync — must not throw, must not return a rejected promise.
      assert.doesNotThrow(() => sendAlert('test'))
      await flush()
    })
  })
})

test('sendAlert — works when webhook is missing (no crash)', async () => {
  await withEnv({ ALERT_SLACK_WEBHOOK: undefined }, async () => {
    assert.doesNotThrow(() => sendAlert('no webhook configured'))
    await flush()
  })
})

const { test } = require('node:test')
const assert = require('node:assert/strict')

function makeRes () {
  return {
    statusCode: 200,
    body: undefined,
    status (code) { this.statusCode = code; return this },
    json (body) { this.body = body; return this }
  }
}

function loadMiddleware (isRunning) {
  const middlewarePath = require.resolve('./proxy.middleware')
  const metricsPath = require.resolve('../metrics')

  delete require.cache[middlewarePath]
  delete require.cache[metricsPath]

  require.cache[metricsPath] = {
    id: metricsPath,
    filename: metricsPath,
    loaded: true,
    exports: { state: { isRunning } }
  }

  return require('./proxy.middleware')
}

test('proxyStateMiddleware calls next when proxy is running', () => {
  const middleware = loadMiddleware(true)
  let nextCalled = false
  middleware({}, makeRes(), () => { nextCalled = true })
  assert.ok(nextCalled)
})

test('proxyStateMiddleware returns 503 when proxy is stopped', () => {
  const middleware = loadMiddleware(false)
  const res = makeRes()
  let nextCalled = false
  middleware({}, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 503)
  assert.ok(res.body.error)
})

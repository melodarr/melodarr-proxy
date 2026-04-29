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

function loadController ({ isRunning = true, cleared = false } = {}) {
  const controllerPath = require.resolve('./control.controller')
  const metricsPath = require.resolve('../metrics')
  const cachePath = require.resolve('../cache')

  delete require.cache[controllerPath]
  delete require.cache[metricsPath]
  delete require.cache[cachePath]

  const metrics = {
    state: { isRunning },
    startProxy () { this.state.isRunning = true },
    stopProxy () { this.state.isRunning = false },
    events: [],
    emit (event) { this.events.push(event) }
  }

  require.cache[metricsPath] = {
    id: metricsPath,
    filename: metricsPath,
    loaded: true,
    exports: metrics
  }

  require.cache[cachePath] = {
    id: cachePath,
    filename: cachePath,
    loaded: true,
    exports: { async clear () { return cleared } }
  }

  return { controller: require('./control.controller'), metrics }
}

// ── startProxy ────────────────────────────────────────────────────

test('startProxy returns isRunning=true and a message', () => {
  const { controller } = loadController({ isRunning: false })
  const res = makeRes()
  controller.startProxy({}, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.isRunning, true)
  assert.ok(res.body.message)
})

test('startProxy sets metrics.state.isRunning to true', () => {
  const { controller, metrics } = loadController({ isRunning: false })
  controller.startProxy({}, makeRes())
  assert.equal(metrics.state.isRunning, true)
})

// ── stopProxy ─────────────────────────────────────────────────────

test('stopProxy returns isRunning=false and a message', () => {
  const { controller } = loadController({ isRunning: true })
  const res = makeRes()
  controller.stopProxy({}, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.isRunning, false)
  assert.ok(res.body.message)
})

test('stopProxy sets metrics.state.isRunning to false', () => {
  const { controller, metrics } = loadController({ isRunning: true })
  controller.stopProxy({}, makeRes())
  assert.equal(metrics.state.isRunning, false)
})

// ── clearCache ────────────────────────────────────────────────────

test('clearCache returns success message', async () => {
  const { controller } = loadController()
  const res = makeRes()
  await controller.clearCache({}, res)
  assert.equal(res.statusCode, 200)
  assert.ok(res.body.message)
})

// ── triggerSync ───────────────────────────────────────────────────

test('triggerSync returns a message and timestamp', () => {
  const { controller } = loadController()
  const res = makeRes()
  controller.triggerSync({}, res)
  assert.equal(res.statusCode, 200)
  assert.ok(res.body.message)
  assert.ok(typeof res.body.timestamp === 'string')
})

test('triggerSync emits sync_triggered event on metrics', () => {
  const { controller, metrics } = loadController()
  controller.triggerSync({}, makeRes())
  assert.ok(metrics.events.includes('sync_triggered'))
})

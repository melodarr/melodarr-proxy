const assert = require('node:assert/strict')
const test = require('node:test')

const { pathAuthMiddleware } = require('./api.routes')

test('pathAuthMiddleware accepts legacy hex API keys in path', () => {
  const req = {
    params: { apiKey: 'bc57be1e98bed038597f1fed0f058137' },
    query: {}
  }

  let nextArg
  pathAuthMiddleware(req, {}, (arg) => {
    nextArg = arg
  })

  assert.equal(nextArg, undefined)
  assert.equal(req.pathApiKey, 'bc57be1e98bed038597f1fed0f058137')
  assert.equal(req.query.api_key, undefined)
})

test('pathAuthMiddleware accepts mp-prefixed API keys in path', () => {
  const req = {
    params: { apiKey: 'mp_example' },
    query: {}
  }

  let nextArg
  pathAuthMiddleware(req, {}, (arg) => {
    nextArg = arg
  })

  assert.equal(nextArg, undefined)
  assert.equal(req.pathApiKey, 'mp_example')
  assert.equal(req.query.api_key, undefined)
})

test('pathAuthMiddleware skips route when path key is missing', () => {
  const req = {
    params: {},
    query: {}
  }

  let nextArg
  pathAuthMiddleware(req, {}, (arg) => {
    nextArg = arg
  })

  assert.equal(nextArg, 'route')
  assert.equal(req.pathApiKey, undefined)
  assert.equal(req.query.api_key, undefined)
})

test('settings rollback route requires settings auth and CSRF before handler', () => {
  const router = require('./api.routes')
  const layer = router.stack.find((layer) => layer.route?.path === '/settings/rollback' && layer.route.methods.post)

  assert.ok(layer, 'expected POST /settings/rollback route to be registered')
  assert.deepEqual(
    layer.route.stack.map((stackLayer) => stackLayer.handle.name),
    ['requireSettingsAuth', 'requireSettingsCsrf', 'applyRollback']
  )
})

test('image proxy routes are public so Lidarr media cover fetches do not need API auth', () => {
  const router = require('./api.routes')
  const headLayer = router.stack.find((layer) => layer.route?.path === '/image' && layer.route.methods.head)
  const getLayer = router.stack.find((layer) => layer.route?.path === '/image' && layer.route.methods.get)

  assert.ok(headLayer, 'expected HEAD /image route to be registered')
  assert.ok(getLayer, 'expected GET /image route to be registered')
  assert.deepEqual(headLayer.route.stack.map((stackLayer) => stackLayer.handle.name), ['handleImageHead'])
  assert.deepEqual(getLayer.route.stack.map((stackLayer) => stackLayer.handle.name), ['handleImageProxy'])
})

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

function loadController ({ createKey, listKeys, deleteKey } = {}) {
  const controllerPath = require.resolve('./admin.controller')
  const apiKeysPath = require.resolve('../auth/apikeys')

  delete require.cache[controllerPath]
  delete require.cache[apiKeysPath]

  require.cache[apiKeysPath] = {
    id: apiKeysPath,
    filename: apiKeysPath,
    loaded: true,
    exports: {
      createKey: createKey || (() => ({ id: 'new-id', key: 'mp_abc' })),
      listKeys: listKeys || (() => []),
      deleteKey: deleteKey || (() => false)
    }
  }

  return require('./admin.controller')
}

// ── generateKey ───────────────────────────────────────────────────

test('generateKey returns 400 when name is missing', () => {
  const { generateKey } = loadController()
  const res = makeRes()
  generateKey({ body: {} }, res)
  assert.equal(res.statusCode, 400)
  assert.ok(res.body.error)
})

test('generateKey returns 400 when body is empty', () => {
  const { generateKey } = loadController()
  const res = makeRes()
  generateKey({ body: null }, res)
  assert.equal(res.statusCode, 400)
})

test('generateKey returns the new key and id on success', () => {
  const { generateKey } = loadController({
    createKey: () => ({ id: 'test-id', key: 'mp_secret' })
  })
  const res = makeRes()
  generateKey({ body: { name: 'Lidarr', quota: 30 } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.id, 'test-id')
  assert.equal(res.body.key, 'mp_secret')
  assert.ok(res.body.message)
})

test('generateKey uses default quota of 60 when not provided', () => {
  let capturedArgs
  const { generateKey } = loadController({
    createKey: (name, quota) => { capturedArgs = [name, quota]; return { id: 'x', key: 'mp_x' } }
  })
  generateKey({ body: { name: 'App' } }, makeRes())
  assert.equal(capturedArgs[1], 60)
})

// ── getAllKeys ────────────────────────────────────────────────────

test('getAllKeys returns the list of keys', () => {
  const keys = [
    { id: '1', name: 'App', quotaPerMinute: 60, usage: 0, createdAt: '2024-01-01', lastUsedAt: null }
  ]
  const { getAllKeys } = loadController({ listKeys: () => keys })
  const res = makeRes()
  getAllKeys({}, res)
  assert.deepEqual(res.body.keys, keys)
})

test('getAllKeys returns empty list when no keys exist', () => {
  const { getAllKeys } = loadController({ listKeys: () => [] })
  const res = makeRes()
  getAllKeys({}, res)
  assert.deepEqual(res.body.keys, [])
})

// ── revokeKey ─────────────────────────────────────────────────────

test('revokeKey returns 400 when key param is missing', () => {
  const { revokeKey } = loadController()
  const res = makeRes()
  revokeKey({ params: {} }, res)
  assert.equal(res.statusCode, 400)
})

test('revokeKey returns 404 when key is not found', () => {
  const { revokeKey } = loadController({ deleteKey: () => false })
  const res = makeRes()
  revokeKey({ params: { key: 'nonexistent' } }, res)
  assert.equal(res.statusCode, 404)
})

test('revokeKey returns success message when key is deleted', () => {
  const { revokeKey } = loadController({ deleteKey: () => true })
  const res = makeRes()
  revokeKey({ params: { key: 'existing-id' } }, res)
  assert.equal(res.statusCode, 200)
  assert.ok(res.body.message)
})

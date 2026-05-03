const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')

// Helper to build a fake HMAC-signed token (same algorithm as settings.controller)
function makeToken (secret, exp = Date.now() + 86400000) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function makeExpiredToken (secret) {
  return makeToken(secret, Date.now() - 1000)
}

function makeRes () {
  return {
    statusCode: 200,
    body: undefined,
    cookies: {},
    clearedCookies: [],
    status (code) { this.statusCode = code; return this },
    json (body) { this.body = body; return this },
    cookie (name, value, opts) { this.cookies[name] = { value, opts } },
    clearCookie (name) { this.clearedCookies.push(name) }
  }
}

const COOKIE = 'melodarr_proxy_settings'
const SESSION_SECRET = 'test-session-secret-32bytes-long'

function makeReqWithValidCookie () {
  const token = makeToken(SESSION_SECRET)
  return { method: 'GET', headers: { cookie: `${COOKIE}=${encodeURIComponent(token)}` } }
}

function makeReqWithExpiredCookie () {
  const token = makeExpiredToken(SESSION_SECRET)
  return { method: 'GET', headers: { cookie: `${COOKIE}=${encodeURIComponent(token)}` } }
}

function loadController ({
  hasAdminPassword = true,
  canBootstrapAdmin = false,
  sessionSecret = SESSION_SECRET,
  verifyPassword = () => false,
  bootstrapAdminPassword = () => {},
  getRuntimeConfig = () => ({}),
  updateRuntimeConfig = () => ({ applied: {}, cleared: {}, skipped: {} }),
  clearRuntimeOverride = () => ({ ok: true, cleared: true, key: 'unspecified', newValue: null, newSource: 'default' }),
  generateRandomName = () => 'Test Name 42',
  validateConfigInMemory = async (updates, fn) => { const result = await fn(); return { ...result, diff: {} } },
  getCurrentSettingsVersion = async () => '12345',
  getSettingsVersions = async () => ({ current: '12345', lastKnownGood: '12345', versions: [] }),
  getSettingsVersion = async (id) => ({ meta: { id }, settings: {} }),
  rollbackSettings = async () => ({ ok: true }),
  validator = () => Promise.resolve({ code: 0, output: 'mocked test', failedChecks: [] })
} = {}) {
  const controllerPath = require.resolve('./settings.controller')
  const storePath = require.resolve('../settings/store')

  delete require.cache[controllerPath]
  delete require.cache[storePath]

  const healthControllerPath = require.resolve('./health.controller')
  delete require.cache[healthControllerPath]
  require.cache[healthControllerPath] = {
    id: healthControllerPath,
    filename: healthControllerPath,
    loaded: true,
    exports: {
      getHealthStatus: async () => ({ status: 'ok' })
    }
  }

  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      hasAdminPassword: () => hasAdminPassword,
      canBootstrapAdmin: () => canBootstrapAdmin,
      getSessionSecret: () => sessionSecret,
      verifyPassword,
      bootstrapAdminPassword,
      getRuntimeConfig,
      updateRuntimeConfig,
      clearRuntimeOverride,
      generateRandomName,
      getCurrentSettingsVersion,
      getSettingsVersions,
      getSettingsVersion,
      markLastKnownGood: async () => {},
      rollbackSettings,
      flushSettingsWrites: async () => {},
      setInternalValidatorKey: () => {},
      validateConfigInMemory
    }
  }

  const controller = require('./settings.controller')
  controller.setValidator(validator)
  return controller
}

// ── isAuthenticated ───────────────────────────────────────────────

test('isAuthenticated returns false when no cookie is present', () => {
  const c = loadController()
  assert.equal(c.isAuthenticated({ headers: {} }), false)
})

test('isAuthenticated returns false when cookie is missing', () => {
  const c = loadController()
  assert.equal(c.isAuthenticated({ headers: { cookie: 'some=other' } }), false)
})

test('isAuthenticated returns false when token is expired', () => {
  const c = loadController()
  assert.equal(c.isAuthenticated(makeReqWithExpiredCookie()), false)
})

test('isAuthenticated returns false when no admin password is configured', () => {
  const c = loadController({ hasAdminPassword: false })
  assert.equal(c.isAuthenticated(makeReqWithValidCookie()), false)
})

test('isAuthenticated returns false when session secret is empty', () => {
  const c = loadController({ sessionSecret: '' })
  assert.equal(c.isAuthenticated(makeReqWithValidCookie()), false)
})

test('isAuthenticated returns true for a valid unexpired token', () => {
  const c = loadController()
  assert.equal(c.isAuthenticated(makeReqWithValidCookie()), true)
})

// ── getSettingsStatus ─────────────────────────────────────────────

test('getSettingsStatus returns enabled, setupRequired, authenticated fields', () => {
  const c = loadController({ hasAdminPassword: true, canBootstrapAdmin: false })
  const res = makeRes()
  c.getSettingsStatus({ headers: {} }, res)
  assert.equal(typeof res.body.enabled, 'boolean')
  assert.equal(typeof res.body.setupRequired, 'boolean')
  assert.equal(typeof res.body.authenticated, 'boolean')
})

test('getSettingsStatus returns a csrfToken for authenticated sessions', () => {
  const c = loadController({ hasAdminPassword: true, canBootstrapAdmin: false })
  const req = makeReqWithValidCookie()
  const res = makeRes()
  c.getSettingsStatus(req, res)
  assert.equal(res.body.authenticated, true)
  assert.equal(res.body.csrfToken, c.getSettingsCsrfToken(req))
})

test('getSettingsStatus reflects hasAdminPassword correctly', () => {
  const c = loadController({ hasAdminPassword: false, canBootstrapAdmin: true })
  const res = makeRes()
  c.getSettingsStatus({ headers: {} }, res)
  assert.equal(res.body.enabled, false)
  assert.equal(res.body.setupRequired, true)
})

// ── setupSettings ─────────────────────────────────────────────────

test('setupSettings returns 409 when admin password is already configured', () => {
  const c = loadController({ canBootstrapAdmin: false })
  const res = makeRes()
  c.setupSettings({ body: { password: 'ValidPass1!' } }, res)
  assert.equal(res.statusCode, 409)
})

test('setupSettings returns 400 when password is shorter than 8 characters', () => {
  const c = loadController({ canBootstrapAdmin: true })
  const res = makeRes()
  c.setupSettings({ body: { password: 'short' } }, res)
  assert.equal(res.statusCode, 400)
})

test('setupSettings calls bootstrapAdminPassword and sets auth cookie on success', () => {
  let capturedPassword
  const c = loadController({
    canBootstrapAdmin: true,
    bootstrapAdminPassword: (pw) => { capturedPassword = pw }
  })
  const res = makeRes()
  c.setupSettings({ body: { password: 'ValidPassword1!' } }, res)
  assert.equal(capturedPassword, 'ValidPassword1!')
  assert.ok(COOKIE in res.cookies)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.csrfToken, c.getSettingsCsrfToken({ headers: { cookie: `${COOKIE}=${encodeURIComponent(res.cookies[COOKIE].value)}` } }))
})

// ── loginSettings ─────────────────────────────────────────────────

test('loginSettings returns 503 when no admin password is configured', () => {
  const c = loadController({ hasAdminPassword: false })
  const res = makeRes()
  c.loginSettings({ body: { password: 'anything' } }, res)
  assert.equal(res.statusCode, 503)
})

test('loginSettings returns 401 when password is incorrect', () => {
  const c = loadController({ hasAdminPassword: true, verifyPassword: () => false })
  const res = makeRes()
  c.loginSettings({ body: { password: 'wrong' } }, res)
  assert.equal(res.statusCode, 401)
})

test('loginSettings sets auth cookie and returns ok on correct password', () => {
  const c = loadController({ hasAdminPassword: true, verifyPassword: () => true })
  const res = makeRes()
  c.loginSettings({ body: { password: 'correct' } }, res)
  assert.equal(res.body.ok, true)
  assert.ok(COOKIE in res.cookies)
  assert.equal(res.body.csrfToken, c.getSettingsCsrfToken({ headers: { cookie: `${COOKIE}=${encodeURIComponent(res.cookies[COOKIE].value)}` } }))
})

// ── logoutSettings ────────────────────────────────────────────────

test('logoutSettings clears the settings cookie and returns ok', () => {
  const c = loadController()
  const res = makeRes()
  c.logoutSettings({}, res)
  assert.ok(res.clearedCookies.includes(COOKIE))
  assert.equal(res.body.ok, true)
})

// ── requireSettingsAuth ───────────────────────────────────────────

test('requireSettingsAuth calls next when session is authenticated', () => {
  const c = loadController()
  let nextCalled = false
  c.requireSettingsAuth(makeReqWithValidCookie(), makeRes(), () => { nextCalled = true })
  assert.ok(nextCalled)
})

test('requireSettingsAuth returns 401 when not authenticated', () => {
  const c = loadController()
  const res = makeRes()
  let nextCalled = false
  c.requireSettingsAuth({ headers: {} }, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 401)
})

test('requireSettingsAuth returns 401 with setup message when no password configured', () => {
  const c = loadController({ hasAdminPassword: false })
  const res = makeRes()
  c.requireSettingsAuth({ headers: {} }, res, () => {})
  assert.ok(res.body.error.includes('not configured'))
})

// ── CSRF protection ──────────────────────────────────────────────

test('requireSettingsCsrf rejects cookie-authenticated unsafe requests without token', () => {
  const c = loadController()
  const res = makeRes()
  let nextCalled = false
  c.requireSettingsCsrf({ ...makeReqWithValidCookie(), method: 'POST', body: {} }, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 403)
})

test('requireSettingsCsrf accepts cookie-authenticated unsafe requests with valid token', () => {
  const c = loadController()
  const req = { ...makeReqWithValidCookie(), method: 'POST', body: {} }
  req.headers['x-csrf-token'] = c.getSettingsCsrfToken(req)
  let nextCalled = false
  c.requireSettingsCsrf(req, makeRes(), () => { nextCalled = true })
  assert.equal(nextCalled, true)
})

test('requireSettingsCsrfIfSession bypasses API-key style requests without settings cookie', () => {
  const c = loadController()
  let nextCalled = false
  c.requireSettingsCsrfIfSession({ method: 'POST', headers: { 'x-api-key': 'mp_key' } }, makeRes(), () => { nextCalled = true })
  assert.equal(nextCalled, true)
})

// ── updateSettings ────────────────────────────────────────────────

test('updateSettings returns 400 when no updates provided', async () => {
  const c = loadController()
  const res = makeRes()
  await c.updateSettings({ body: {} }, res)
  assert.equal(res.statusCode, 400)
})

test('updateSettings returns 400 when body is null', async () => {
  const c = loadController()
  const res = makeRes()
  await c.updateSettings({ body: null }, res)
  assert.equal(res.statusCode, 400)
})

test('updateSettings calls updateRuntimeConfig and returns applied/skipped', async () => {
  const c = loadController({
    updateRuntimeConfig: () => ({
      applied: { cacheTtlSeconds: 7200 },
      skipped: {}
    })
  })
  const res = makeRes()
  await c.updateSettings({ body: { cacheTtlSeconds: 7200 } }, res)
  assert.equal(res.body.ok, true)
  assert.deepEqual(res.body.applied, { cacheTtlSeconds: 7200 })
})

// ── generateName / getNameHistory ────────────────────────────────

test('generateName returns a new name', () => {
  const c = loadController({ generateRandomName: () => 'Cosmic Wave 42' })
  const res = makeRes()
  c.generateName({}, res)
  assert.equal(res.body.name, 'Cosmic Wave 42')
})

test('getNameHistory returns previously generated names', () => {
  const c = loadController({ generateRandomName: () => 'Silver Echo 7' })
  c.generateName({}, makeRes())
  const res = makeRes()
  c.getNameHistory({}, res)
  assert.ok(Array.isArray(res.body))
  assert.ok(res.body.includes('Silver Echo 7'))
})

// ── clearRuntimeSetting ───────────────────────────────────────────

test('clearRuntimeSetting returns 400 when key is missing', () => {
  const c = loadController()
  const res = makeRes()
  c.clearRuntimeSetting({ params: {} }, res)
  assert.equal(res.statusCode, 400)
})

test('clearRuntimeSetting returns 404 for unknown key', () => {
  const c = loadController({
    clearRuntimeOverride: () => ({ ok: false, reason: 'unknown_key' })
  })
  const res = makeRes()
  c.clearRuntimeSetting({ params: { key: 'bogus' } }, res)
  assert.equal(res.statusCode, 404)
})

test('clearRuntimeSetting returns ok true with cleared=true and new value/source', () => {
  let receivedKey
  const c = loadController({
    clearRuntimeOverride: (key) => {
      receivedKey = key
      return { ok: true, cleared: true, key, newValue: 'itunes,theaudiodb,discogs', newSource: 'env' }
    }
  })
  const res = makeRes()
  c.clearRuntimeSetting({ params: { key: 'metadataProviders' } }, res)
  assert.equal(receivedKey, 'metadataProviders')
  assert.equal(res.body.ok, true)
  assert.equal(res.body.cleared, true)
  assert.equal(res.body.newValue, 'itunes,theaudiodb,discogs')
  assert.equal(res.body.newSource, 'env')
})

test('clearRuntimeSetting returns cleared=false when no override existed', () => {
  const c = loadController({
    clearRuntimeOverride: (key) => ({ ok: true, cleared: false, key, newValue: 'fallback', newSource: 'default' })
  })
  const res = makeRes()
  c.clearRuntimeSetting({ params: { key: 'cacheTtlSeconds' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.cleared, false)
})

// ── updateSettings null-clear ─────────────────────────────────────

test('updateSettings exposes cleared map alongside applied', async () => {
  const c = loadController({
    updateRuntimeConfig: () => ({
      applied: { appName: 'New Name' },
      cleared: { metadataProviders: true },
      skipped: {}
    })
  })
  const res = makeRes()
  await c.updateSettings({ body: { appName: 'New Name', metadataProviders: null } }, res)
  assert.equal(res.body.ok, true)
  assert.deepEqual(res.body.applied, { appName: 'New Name' })
  assert.deepEqual(res.body.cleared, { metadataProviders: true })
})

// ── validateSettingsEndpoint ──────────────────────────────────────

test('validateSettingsEndpoint returns 400 when no updates provided', async () => {
  const c = loadController()
  const res = makeRes()
  await c.validateSettingsEndpoint({ body: {} }, res)
  assert.equal(res.statusCode, 400)
})

test('validateSettingsEndpoint returns validation result', async () => {
  const c = loadController({
    validateConfigInMemory: async (updates, fn) => {
      return { code: 0, output: 'mocked test', diff: { modified: true } }
    }
  })
  const res = makeRes()
  await c.validateSettingsEndpoint({ body: { cacheTtlSeconds: 100 } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.code, 0)
  assert.equal(res.body.output, 'mocked test')
  assert.deepEqual(res.body.diff, { modified: true })
})

// ── Versioning and Rollback ──────────────────────────────────────

test('listVersions returns current, lastKnownGood, and reversed versions', async () => {
  const c = loadController({
    getSettingsVersions: async () => ({
      current: '2',
      lastKnownGood: '1',
      versions: [{ id: '1' }, { id: '2' }]
    })
  })
  const res = makeRes()
  await c.listVersions({}, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.current, '2')
  assert.equal(res.body.lastKnownGood, '1')
  assert.deepEqual(res.body.versions, [{ id: '2' }, { id: '1' }])
})

test('getCurrentVersionMeta returns 404 when no current version', async () => {
  const c = loadController({
    getSettingsVersions: async () => ({ current: null, lastKnownGood: null, versions: [] })
  })
  const res = makeRes()
  await c.getCurrentVersionMeta({}, res)
  assert.equal(res.statusCode, 404)
})

test('getCurrentVersionMeta returns meta for current version', async () => {
  const c = loadController({
    getSettingsVersions: async () => ({
      current: '123',
      lastKnownGood: '123',
      versions: [{ id: '123', actor: 'system' }]
    })
  })
  const res = makeRes()
  await c.getCurrentVersionMeta({}, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.meta, { id: '123', actor: 'system' })
})

test('getVersion returns version metadata and settings', async () => {
  const c = loadController({
    getSettingsVersion: async (id) => ({
      meta: { id, actor: 'system' },
      settings: { runtime: { appVersion: '1.0.0' } }
    })
  })
  const res = makeRes()
  await c.getVersion({ params: { id: '1700000000000-1234567890abcdef' } }, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    meta: { id: '1700000000000-1234567890abcdef', actor: 'system' },
    settings: { runtime: { appVersion: '1.0.0' } }
  })
})

test('getVersion returns 400 for malformed version ids', async () => {
  const c = loadController({
    getSettingsVersion: async () => { throw new Error('Invalid versionId') }
  })
  const res = makeRes()
  await c.getVersion({ params: { id: '../settings.json' } }, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error, 'Invalid versionId')
})

test('getVersion returns 404 for missing versions', async () => {
  const c = loadController({
    getSettingsVersion: async () => { throw new Error('Version 1700000000000-1234567890abcdef not found') }
  })
  const res = makeRes()
  await c.getVersion({ params: { id: '1700000000000-1234567890abcdef' } }, res)
  assert.equal(res.statusCode, 404)
})

test('applyRollback returns 400 when versionId is missing', async () => {
  const c = loadController()
  const res = makeRes()
  await c.applyRollback({ body: {}, query: {} }, res)
  assert.equal(res.statusCode, 400)
})

test('applyRollback calls rollbackSettings with correct parameters', async () => {
  let calledVersionId, calledDryRun, calledActor
  const c = loadController({
    rollbackSettings: async (vid, dryRun, actor) => {
      calledVersionId = vid
      calledDryRun = dryRun
      calledActor = actor
      return { ok: true, rolledBackTo: vid }
    }
  })
  const res = makeRes()
  await c.applyRollback({ body: { versionId: '456' }, query: { dryRun: '1' }, ip: '127.0.0.1' }, res)

  assert.equal(res.statusCode, 200)
  assert.equal(calledVersionId, '456')
  assert.equal(calledDryRun, true)
  assert.equal(calledActor, 'operator (127.0.0.1)')
  assert.equal(res.body.rolledBackTo, '456')
})

test('applyRollback returns 500 for unexpected rollback errors', async () => {
  const c = loadController({
    rollbackSettings: async () => { throw new Error('Rollback failed') }
  })
  const res = makeRes()
  await c.applyRollback({ body: { versionId: '456' }, query: {} }, res)

  assert.equal(res.statusCode, 500)
  assert.equal(res.body.error, 'Rollback failed')
})

test('applyRollback surfaces malformed version ids as 400', async () => {
  const c = loadController({
    rollbackSettings: async () => { throw new Error('Invalid versionId') }
  })
  const res = makeRes()
  await c.applyRollback({ body: { versionId: '../settings.json' }, query: {} }, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error, 'Invalid versionId')
})

test('applyRollback returns 404 when target version is not found', async () => {
  const c = loadController({
    rollbackSettings: async () => { throw new Error('Version 999 not found') }
  })
  const res = makeRes()
  await c.applyRollback({ body: { versionId: '999' }, query: {} }, res)
  assert.equal(res.statusCode, 404)
  assert.equal(res.body.error, 'Version 999 not found')
})

test('updateSettings triggers rollback on canary failure (code 1)', async () => {
  let rolledBack = false
  const c = loadController({
    getCurrentSettingsVersion: async () => 'prev-version',
    updateRuntimeConfig: () => ({ applied: { someKey: 'val' }, cleared: {}, skipped: {} }),
    rollbackSettings: async () => { rolledBack = true; return { ok: true } }
  })

  c.setValidator(() => Promise.resolve({ code: 1, output: 'canary failed' }))

  const res = makeRes()
  await c.updateSettings({ body: { someKey: 'val' } }, res)

  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error, 'Canary validation failed. Automatically rolled back.')
  assert.equal(rolledBack, true)
})

test('updateSettings triggers rollback on provisional failure (code 2)', async () => {
  let rolledBack = false
  const c = loadController({
    getCurrentSettingsVersion: async () => 'prev-version',
    updateRuntimeConfig: () => ({ applied: { someKey: 'val' }, cleared: {}, skipped: {} }),
    rollbackSettings: async () => { rolledBack = true; return { ok: true } }
  })

  c.setValidator(() => Promise.resolve({ code: 2, output: 'provisional failed' }))

  const res = makeRes()
  await c.updateSettings({ body: { someKey: 'val' } }, res)

  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /Canary validation provisional failure/)
  assert.equal(rolledBack, true)
})

test('updateSettings skips rollback on provisional failure if allowProvisional is true', async () => {
  let rolledBack = false
  const c = loadController({
    getCurrentSettingsVersion: async () => 'prev-version',
    updateRuntimeConfig: () => ({ applied: { someKey: 'val' }, cleared: {}, skipped: {} }),
    rollbackSettings: async () => { rolledBack = true; return { ok: true } }
  })

  c.setValidator(() => Promise.resolve({ code: 2, output: 'provisional failed' }))

  const res = makeRes()
  await c.updateSettings({ body: { someKey: 'val', allowProvisional: true } }, res)

  assert.equal(res.statusCode, 200)
  assert.equal(rolledBack, false)
})

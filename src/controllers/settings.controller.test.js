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
  return { headers: { cookie: `${COOKIE}=${encodeURIComponent(token)}` } }
}

function makeReqWithExpiredCookie () {
  const token = makeExpiredToken(SESSION_SECRET)
  return { headers: { cookie: `${COOKIE}=${encodeURIComponent(token)}` } }
}

function loadController ({
  hasAdminPassword = true,
  canBootstrapAdmin = false,
  sessionSecret = SESSION_SECRET,
  verifyPassword = () => false,
  bootstrapAdminPassword = () => {},
  getRuntimeConfig = () => ({}),
  updateRuntimeConfig = () => ({ applied: {}, skipped: {} }),
  generateRandomName = () => 'Test Name 42'
} = {}) {
  const controllerPath = require.resolve('./settings.controller')
  const storePath = require.resolve('../settings/store')

  delete require.cache[controllerPath]
  delete require.cache[storePath]

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
      generateRandomName
    }
  }

  return require('./settings.controller')
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

// ── updateSettings ────────────────────────────────────────────────

test('updateSettings returns 400 when no updates provided', () => {
  const c = loadController()
  const res = makeRes()
  c.updateSettings({ body: {} }, res)
  assert.equal(res.statusCode, 400)
})

test('updateSettings returns 400 when body is null', () => {
  const c = loadController()
  const res = makeRes()
  c.updateSettings({ body: null }, res)
  assert.equal(res.statusCode, 400)
})

test('updateSettings calls updateRuntimeConfig and returns applied/skipped', () => {
  const c = loadController({
    updateRuntimeConfig: () => ({
      applied: { cacheTtlSeconds: 7200 },
      skipped: {}
    })
  })
  const res = makeRes()
  c.updateSettings({ body: { cacheTtlSeconds: 7200 } }, res)
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

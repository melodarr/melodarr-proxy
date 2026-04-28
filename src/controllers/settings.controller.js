const crypto = require('crypto')
const {
  bootstrapAdminPassword,
  canBootstrapAdmin,
  generateRandomName,
  getRuntimeConfig,
  getSessionSecret,
  hasAdminPassword,
  updateRuntimeConfig,
  verifyPassword
} = require('../settings/store')
const { testProvider } = require('../providers')

const SETTINGS_COOKIE = 'melodarr_proxy_settings'
const SETTINGS_SESSION_TTL_MS = 12 * 60 * 60 * 1000

function getCookie (req, name) {
  const cookies = req.headers.cookie || ''
  const match = cookies
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))

  return match ? decodeURIComponent(match.slice(name.length + 1)) : ''
}

function signPayload (payload) {
  return crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url')
}

function createToken () {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SETTINGS_SESSION_TTL_MS })).toString('base64url')
  return `${payload}.${signPayload(payload)}`
}

function isTokenValid (token) {
  if (!hasAdminPassword() || !getSessionSecret() || !token) {
    return false
  }

  const [payload, signature] = token.split('.')

  if (!payload || !signature) {
    return false
  }

  const expected = signPayload(payload)
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)

  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return false
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return Number(parsed.exp) > Date.now()
  } catch (_error) {
    return false
  }
}

function isAuthenticated (req) {
  return isTokenValid(getCookie(req, SETTINGS_COOKIE))
}

function setAuthCookie (res) {
  res.cookie(SETTINGS_COOKIE, createToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: SETTINGS_SESSION_TTL_MS
  })
}

function requireSettingsAuth (req, res, next) {
  if (isAuthenticated(req)) {
    return next()
  }

  return res.status(401).json({
    error: hasAdminPassword() ? 'Authentication required' : 'Settings password is not configured'
  })
}

function getSettingsPayload () {
  const runtimeConfig = getRuntimeConfig()

  return {
    config: runtimeConfig,
    admin: {
      passwordConfigured: hasAdminPassword(),
      envPasswordConfigured: Boolean(process.env.ADMIN_PASSWORD),
      bootstrapAvailable: canBootstrapAdmin()
    },
    server: {
      port: { value: Number(process.env.PORT || 3000), source: 'env' },
      redisUrl: { value: process.env.REDIS_URL || 'redis://localhost:6379', source: 'env' }
    }
  }
}

function getSettingsStatus (req, res) {
  res.json({
    enabled: hasAdminPassword(),
    setupRequired: canBootstrapAdmin(),
    authenticated: isAuthenticated(req)
  })
}

function setupSettings (req, res) {
  if (!canBootstrapAdmin()) {
    return res.status(409).json({
      error: 'Admin password is already configured'
    })
  }

  const password = String(req.body?.password || '')

  if (password.length < 8) {
    return res.status(400).json({
      error: 'Password must be at least 8 characters'
    })
  }

  bootstrapAdminPassword(password)
  setAuthCookie(res)

  return res.json({
    ok: true
  })
}

function loginSettings (req, res) {
  if (!hasAdminPassword()) {
    return res.status(503).json({
      error: 'Create the admin password before signing in'
    })
  }

  if (!verifyPassword(String(req.body?.password || ''))) {
    return res.status(401).json({
      error: 'Invalid password'
    })
  }

  setAuthCookie(res)

  return res.json({
    ok: true
  })
}

function logoutSettings (_req, res) {
  res.clearCookie(SETTINGS_COOKIE)
  res.json({
    ok: true
  })
}

function getSettings (_req, res) {
  res.json(getSettingsPayload())
}

const nameHistory = []

function getNameHistory (_req, res) {
  res.json(nameHistory)
}

function generateName (_req, res) {
  const newName = generateRandomName()
  nameHistory.unshift(newName)
  if (nameHistory.length > 10) {
    nameHistory.pop()
  }
  res.json({ name: newName })
}

function updateSettings (req, res) {
  const updates = req.body

  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Provide at least one setting to update' })
  }

  const result = updateRuntimeConfig(updates)

  return res.json({
    ok: true,
    applied: result.applied,
    skipped: result.skipped
  })
}

function buildProviderErrorDetails (error) {
  return {
    message: error.message || 'Provider test failed',
    code: error.code || null,
    status: error.response?.status || null,
    statusText: error.response?.statusText || null,
    url: error.config?.url || null,
    method: error.config?.method || null,
    response: typeof error.response?.data === 'string'
      ? error.response.data.slice(0, 1000)
      : error.response?.data || null
  }
}

async function testSettingsProvider (req, res) {
  const provider = String(req.body?.provider || '').trim()
  const query = String(req.body?.query || 'Radiohead').trim()

  if (!provider) {
    return res.status(400).json({ error: 'Provider is required' })
  }

  if (!query) {
    return res.status(400).json({ error: 'Query is required' })
  }

  try {
    const result = await testProvider(provider, query)
    return res.json({ ok: true, ...result })
  } catch (error) {
    return res.status(502).json({
      ok: false,
      provider,
      query,
      error: error.message || 'Provider test failed',
      details: buildProviderErrorDetails(error)
    })
  }
}

module.exports = {
  generateName,
  getNameHistory,
  getSettings,
  getSettingsStatus,
  isAuthenticated,
  loginSettings,
  logoutSettings,
  requireSettingsAuth,
  setupSettings,
  testSettingsProvider,
  updateSettings
}

const crypto = require('crypto')
const {
  bootstrapAdminPassword,
  canBootstrapAdmin,
  clearRuntimeOverride,
  generateRandomName,
  getRuntimeConfig,
  getSessionSecret,
  hasAdminPassword,
  updateRuntimeConfig,
  getSettingsVersions,
  getSettingsVersion,
  getCurrentSettingsVersion,
  rollbackSettings,
  markLastKnownGood,
  flushSettingsWrites,
  verifyPassword,
  setInternalValidatorKey,
  clearInternalValidatorKey,
  validateConfigInMemory
} = require('../settings/store')
const { testProvider } = require('../providers')
const { execFile } = require('child_process')
const logger = require('../utils/logger')

const SETTINGS_COOKIE = 'melodarr_proxy_settings'
const SETTINGS_SESSION_TTL_MS = 12 * 60 * 60 * 1000
const CSRF_HEADER = 'x-csrf-token'

const SENSITIVE_SETTING_KEYS = new Set([
  'musicbrainzApiKey',
  'lastfmApiKey',
  'discogsToken',
  'theAudioDbApiKey',
  'customProviderToken'
])

function redactSensitiveKeys (obj) {
  if (!obj || typeof obj !== 'object') return obj
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, SENSITIVE_SETTING_KEYS.has(k) ? '[REDACTED]' : v])
  )
}

function getCookie (req, name) {
  const cookies = req.headers?.cookie || ''
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

function createCsrfToken (sessionToken) {
  if (!sessionToken) {
    return ''
  }
  return signPayload(`csrf:${sessionToken}`)
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
  return Boolean(isTokenValid(getCookie(req, SETTINGS_COOKIE)))
}

function setAuthCookie (res) {
  const token = createToken()
  res.cookie(SETTINGS_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: SETTINGS_SESSION_TTL_MS
  })
  return token
}

function getSettingsCsrfToken (req) {
  const token = getCookie(req, SETTINGS_COOKIE)
  return isTokenValid(token) ? createCsrfToken(token) : null
}

function getSubmittedCsrfToken (req) {
  const header = req.headers?.[CSRF_HEADER]
  if (Array.isArray(header)) {
    return String(header[0] || '')
  }
  return String(header || req.body?._csrf || '')
}

function isCsrfTokenValid (req) {
  const expected = getSettingsCsrfToken(req)
  const submitted = getSubmittedCsrfToken(req)

  if (!expected || !submitted) {
    return false
  }

  const expectedBuffer = Buffer.from(expected)
  const submittedBuffer = Buffer.from(submitted)

  return expectedBuffer.length === submittedBuffer.length && crypto.timingSafeEqual(expectedBuffer, submittedBuffer)
}

function isSafeMethod (method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase())
}

function requireSettingsCsrf (req, res, next) {
  if (isSafeMethod(req.method) || isCsrfTokenValid(req)) {
    return next()
  }

  return res.status(403).json({
    error: 'CSRF token required'
  })
}

function requireSettingsCsrfIfSession (req, res, next) {
  if (!isAuthenticated(req) || isSafeMethod(req.method)) {
    return next()
  }

  return requireSettingsCsrf(req, res, next)
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
  const authenticated = isAuthenticated(req)

  res.json({
    enabled: hasAdminPassword(),
    setupRequired: canBootstrapAdmin(),
    authenticated,
    csrfToken: authenticated ? getSettingsCsrfToken(req) : null
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
  const token = setAuthCookie(res)

  return res.json({
    ok: true,
    csrfToken: createCsrfToken(token)
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

  const token = setAuthCookie(res)

  return res.json({
    ok: true,
    csrfToken: createCsrfToken(token)
  })
}

function logoutSettings (_req, res) {
  res.clearCookie(SETTINGS_COOKIE)
  res.json({
    ok: true
  })
}

function getSettings (req, res) {
  res.json({
    ...getSettingsPayload(),
    csrfToken: getSettingsCsrfToken(req)
  })
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

let _validatorFn = null

function setValidator (fn) {
  _validatorFn = fn
}

function runCanaryValidator (mode = 'deploy', nextSettings, diff) {
  if (_validatorFn) return _validatorFn(mode, nextSettings, diff)
  if (process.env.NODE_ENV === 'test') {
    return Promise.resolve({ code: 0, output: 'mocked test' })
  }
  return new Promise((resolve) => {
    const tempKey = `mp_${crypto.randomBytes(32).toString('base64url')}`
    setInternalValidatorKey(tempKey)

    const port = process.env.PORT || 3000
    const baseUrl = `http://127.0.0.1:${port}`
    const scriptPath = require('path').join(process.cwd(), 'scripts/canary-validate.sh')

    execFile('bash', [scriptPath], {
      env: {
        ...process.env,
        BASE_URL: baseUrl,
        API_KEY: tempKey,
        VALIDATION_MODE: mode
      },
      timeout: 30000,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      clearInternalValidatorKey(tempKey)
      const rawOutput = stdout + (stderr ? '\n' + stderr : '')
      const failedChecks = rawOutput
        .split('\n')
        .filter(line => line.includes('✗'))
        .map(line => line.split('✗')[1].trim())
      const exitCode = error
        ? (typeof error.code === 'number' ? error.code : 1)
        : 0

      resolve({
        code: exitCode,
        output: rawOutput,
        failedChecks,
        signal: error && error.signal ? error.signal : null,
        spawnError: error && typeof error.code !== 'number'
          ? {
              code: error.code || null,
              message: error.message
            }
          : null
      })
    })
  })
}

async function updateSettings (req, res) {
  const updates = req.body

  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Provide at least one setting to update' })
  }

  const previousVersion = await getCurrentSettingsVersion()
  const result = updateRuntimeConfig(updates)

  if (Object.keys(result.applied || {}).length > 0 || Object.keys(result.cleared || {}).length > 0) {
    logger.info('config_update', { applied: redactSensitiveKeys(result.applied), cleared: redactSensitiveKeys(result.cleared) })
    await flushSettingsWrites()

    // Check health after config change
    const { buildHealthPayload } = require('./health.controller')
    const health = await buildHealthPayload()

    if (health.status !== 'ok') {
      logger.warn('validation_failed', { reason: 'health check degraded', health })
      if (previousVersion) {
        try {
          await rollbackSettings(previousVersion, false, 'system:auto-rollback')
          logger.info('rollback_applied', { versionId: previousVersion })
        } catch (rollbackErr) {
          logger.error('Auto-rollback failed', { error: rollbackErr.message })
          return res.status(500).json({ error: 'System degraded and auto-rollback failed. Operator intervention required.' })
        }
        return res.status(400).json({
          error: 'Configuration change degraded system health. Automatically rolled back.',
          health
        })
      }
      return res.status(400).json({
        error: 'Configuration change degraded system health.',
        health
      })
    }

    const canaryResult = await runCanaryValidator('config')
    if (canaryResult.code === 1 || canaryResult.code === 3) {
      logger.warn('validation_failed', { reason: 'canary failed', canaryOutput: canaryResult.output, code: canaryResult.code })
      let rolledBack = false
      if (previousVersion) {
        try {
          await rollbackSettings(previousVersion, false, 'system:auto-rollback')
          logger.info('rollback_applied', { versionId: previousVersion })
          rolledBack = true
        } catch (rollbackErr) {
          logger.error('Auto-rollback failed', { error: rollbackErr.message })
          return res.status(500).json({ error: 'Canary validation failed and auto-rollback failed. Operator intervention required.', canaryOutput: canaryResult.output })
        }
      }
      return res.status(400).json({
        error: rolledBack
          ? 'Canary validation failed. Automatically rolled back.'
          : 'Canary validation failed. No previous version available for rollback; new configuration retained.',
        canaryOutput: canaryResult.output,
        failedChecks: canaryResult.failedChecks
      })
    }

    if (canaryResult.code === 2 && process.env.ALLOW_PROVISIONAL_CONFIG !== '1' && req.body.allowProvisional !== true) {
      logger.warn('validation_failed', { reason: 'canary provisional failure', canaryOutput: canaryResult.output })
      let rolledBack = false
      if (previousVersion) {
        try {
          await rollbackSettings(previousVersion, false, 'system:auto-rollback')
          logger.info('rollback_applied', { versionId: previousVersion })
          rolledBack = true
        } catch (rollbackErr) {
          logger.error('Auto-rollback failed', { error: rollbackErr.message })
          return res.status(500).json({ error: 'Canary validation provisional failure and auto-rollback failed. Operator intervention required.', canaryOutput: canaryResult.output })
        }
      }
      return res.status(400).json({
        error: rolledBack
          ? 'Canary validation provisional failure (MB unreachable). Automatically rolled back. Set allowProvisional: true or ALLOW_PROVISIONAL_CONFIG=1 to force.'
          : 'Canary validation provisional failure (MB unreachable). No previous version available for rollback; new configuration retained. Set allowProvisional: true or ALLOW_PROVISIONAL_CONFIG=1 to force.',
        canaryOutput: canaryResult.output,
        failedChecks: canaryResult.failedChecks
      })
    }

    await markLastKnownGood()
  }

  return res.json({
    ok: true,
    applied: result.applied,
    cleared: result.cleared || {},
    skipped: result.skipped
  })
}

async function listVersions (req, res) {
  const index = await getSettingsVersions()
  res.json({
    current: index.current,
    lastKnownGood: index.lastKnownGood,
    versions: index.versions.slice().reverse()
  })
}

function isSettingsVersionNotFoundError (err) {
  return err && (
    err.code === 'ENOENT' ||
    /not found/i.test(err.message || '')
  )
}

function getVersionErrorStatus (err) {
  if (err && err.message === 'Invalid versionId') {
    return 400
  }

  if (isSettingsVersionNotFoundError(err)) {
    return 404
  }

  return 500
}

async function getVersion (req, res) {
  const { id } = req.params
  try {
    const version = await getSettingsVersion(id)
    res.json(version)
  } catch (err) {
    const status = getVersionErrorStatus(err)
    res.status(status).json({ error: err.message })
  }
}

async function applyRollback (req, res) {
  const versionId = req.body?.versionId
  const dryRun = req.query?.dryRun === '1' || req.query?.dryRun === 'true'

  if (!versionId) {
    return res.status(400).json({ error: 'versionId is required' })
  }

  const currentVersion = await getCurrentSettingsVersion()
  if (versionId === currentVersion) {
    return res.status(400).json({ error: 'Cannot rollback to the current active version' })
  }

  try {
    const actor = `operator (${req.ip || 'unknown'})`
    const result = await rollbackSettings(versionId, dryRun, actor)
    if (!dryRun) {
      logger.info('rollback_applied', { versionId, actor })
      await markLastKnownGood()
    }
    res.json(result)
  } catch (err) {
    const status = getVersionErrorStatus(err)
    res.status(status).json({ error: err.message })
  }
}

function clearRuntimeSetting (req, res) {
  const key = String(req.params?.key || '').trim()

  if (!key) {
    return res.status(400).json({ error: 'Setting key is required' })
  }

  const result = clearRuntimeOverride(key)

  if (!result.ok) {
    if (result.reason === 'unknown_key') {
      return res.status(404).json({ error: `Unknown setting: ${key}` })
    }
    return res.status(400).json({ error: 'Could not clear setting' })
  }

  return res.json({
    ok: true,
    key: result.key,
    cleared: result.cleared,
    newValue: result.newValue,
    newSource: result.newSource
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

async function getCurrentVersionMeta (req, res) {
  const index = await getSettingsVersions()
  if (!index.current) {
    return res.status(404).json({ error: 'No current version' })
  }
  const meta = index.versions.find(v => v.id === index.current)
  if (!meta) {
    return res.status(404).json({ error: 'Current version metadata not found' })
  }
  res.json({ meta })
}

async function validateSettingsEndpoint (req, res) {
  const updates = req.body
  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Provide at least one setting to validate' })
  }

  try {
    const result = await validateConfigInMemory(
      updates,
      (nextSettings, diff) => runCanaryValidator('config', nextSettings, diff)
    )
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = {
  clearRuntimeSetting,
  generateName,
  getNameHistory,
  getSettings,
  getSettingsCsrfToken,
  getSettingsStatus,
  isAuthenticated,
  loginSettings,
  logoutSettings,
  requireSettingsAuth,
  requireSettingsCsrf,
  requireSettingsCsrfIfSession,
  setupSettings,
  testSettingsProvider,
  updateSettings,
  listVersions,
  getVersion,
  applyRollback,
  getCurrentVersionMeta,
  validateSettingsEndpoint,
  setValidator
}

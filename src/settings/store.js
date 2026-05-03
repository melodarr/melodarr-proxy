const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const settingsPath = path.join(dataDir, 'settings.json')
let settings = loadSettings()

function loadSettings () {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  } catch (_error) {
    return {}
  }
}

function reloadSettings () {
  if (saveTimeout) {
    return settings
  }
  settings = loadSettings()
  return settings
}

function saveSettingsFile (nextSettings) {
  fs.mkdirSync(dataDir, { recursive: true })
  const tmpPath = `${settingsPath}.tmp.${crypto.randomBytes(4).toString('hex')}`
  fs.writeFileSync(tmpPath, `${JSON.stringify(nextSettings, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tmpPath, settingsPath)
}

function saveSettings (nextSettings) {
  settings = nextSettings
  saveSettingsFile(settings)
}

let saveTimeout = null
function saveSettingsDebounced (nextSettings) {
  settings = nextSettings
  if (!saveTimeout) {
    saveTimeout = setTimeout(() => {
      saveTimeout = null
      saveSettingsFile(settings)
    }, 2000)
    if (saveTimeout.unref) saveTimeout.unref()
  }
}

function hashPassword (password, salt = crypto.randomBytes(16).toString('base64url')) {
  return {
    algorithm: 'scrypt',
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString('base64url')
  }
}

function hashApiKey (apiKey, salt = crypto.randomBytes(16).toString('base64url')) {
  return {
    algorithm: 'scrypt',
    salt,
    hash: crypto.scryptSync(apiKey, salt, 64).toString('base64url')
  }
}

function verifyHash (value, stored) {
  if (!stored?.salt || !stored?.hash) {
    return false
  }

  const nextHash = hashApiKey(value, stored.salt).hash
  const valueBuffer = Buffer.from(nextHash)
  const expectedBuffer = Buffer.from(stored.hash)

  return valueBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(valueBuffer, expectedBuffer)
}

function hasAdminPassword () {
  return Boolean(process.env.ADMIN_PASSWORD || settings.adminPasswordHash)
}

function canBootstrapAdmin () {
  return !hasAdminPassword()
}

function getSessionSecret () {
  if (process.env.SETTINGS_SESSION_SECRET) {
    return process.env.SETTINGS_SESSION_SECRET
  }

  if (process.env.ADMIN_PASSWORD) {
    return process.env.ADMIN_PASSWORD
  }

  return settings.sessionSecret || ''
}

function bootstrapAdminPassword (password) {
  if (!canBootstrapAdmin()) {
    const error = new Error('Admin password is already configured')
    error.status = 409
    throw error
  }

  saveSettings({
    ...settings,
    adminPasswordHash: hashPassword(password),
    sessionSecret: crypto.randomBytes(32).toString('base64url')
  })
}

function verifyPassword (password) {
  if (process.env.ADMIN_PASSWORD) {
    const passwordBuffer = Buffer.from(password)
    const expectedBuffer = Buffer.from(process.env.ADMIN_PASSWORD)
    return passwordBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(passwordBuffer, expectedBuffer)
  }

  if (!settings.adminPasswordHash) {
    return false
  }

  const stored = settings.adminPasswordHash
  const nextHash = hashPassword(password, stored.salt).hash
  const passwordBuffer = Buffer.from(nextHash)
  const expectedBuffer = Buffer.from(stored.hash)

  return passwordBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(passwordBuffer, expectedBuffer)
}

function resetPassword () {
  if (process.env.ADMIN_PASSWORD) {
    return { cleared: false, reason: 'Password is set via ADMIN_PASSWORD env var — remove it from your environment to reset.' }
  }

  if (!settings.adminPasswordHash) {
    return { cleared: false, reason: 'No stored password found. Setup flow will appear on next login.' }
  }

  const next = { ...settings }
  delete next.adminPasswordHash
  delete next.sessionSecret
  saveSettings(next)

  return { cleared: true }
}

function createApiKey ({ name, quotaPerMinute = 60 }) {
  reloadSettings()

  const apiKey = `mp_${crypto.randomBytes(32).toString('base64url')}`
  const id = crypto.randomBytes(8).toString('hex')
  const now = new Date().toISOString()
  const quota = Number(quotaPerMinute)

  const record = {
    id,
    name,
    quotaPerMinute: Number.isFinite(quota) && quota > 0 ? quota : 60,
    hash: hashApiKey(apiKey),
    createdAt: now,
    lastUsedAt: null,
    usage: 0,
    windowStart: Date.now()
  }

  saveSettings({
    ...settings,
    apiKeys: [...(settings.apiKeys || []), record]
  })

  return {
    id,
    key: apiKey
  }
}

function listApiKeys () {
  reloadSettings()

  return (settings.apiKeys || []).map((key) => ({
    id: key.id,
    name: key.name,
    quotaPerMinute: key.quotaPerMinute,
    usage: key.usage || 0,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt
  }))
}

function deleteApiKey (id) {
  reloadSettings()

  const keys = settings.apiKeys || []
  const nextKeys = keys.filter((key) => key.id !== id)

  if (nextKeys.length === keys.length) {
    return false
  }

  saveSettings({
    ...settings,
    apiKeys: nextKeys
  })

  return true
}

function checkApiKey (apiKey) {
  // Omit reloadSettings() on the hot path to prevent synchronous disk reads
  const keys = settings.apiKeys || []
  const index = keys.findIndex((key) => verifyHash(apiKey, key.hash))

  if (index === -1) {
    return { valid: false, reason: 'invalid_key' }
  }

  const key = { ...keys[index] }
  const now = Date.now()

  if (!key.windowStart || now - key.windowStart > 60000) {
    key.usage = 0
    key.windowStart = now
  }

  if ((key.usage || 0) >= key.quotaPerMinute) {
    return { valid: false, reason: 'quota_exceeded', id: key.id, name: key.name }
  }

  key.usage = (key.usage || 0) + 1
  key.lastUsedAt = new Date(now).toISOString()

  const nextKeys = [...keys]
  nextKeys[index] = key

  saveSettingsDebounced({
    ...settings,
    apiKeys: nextKeys
  })

  return {
    valid: true,
    id: key.id,
    name: key.name
  }
}

const ADJECTIVES = [
  'Silver', 'Crimson', 'Silent', 'Azure', 'Golden', 'Cosmic', 'Lunar', 'Solar',
  'Velvet', 'Crystal', 'Iron', 'Neon', 'Aqua', 'Jade', 'Obsidian', 'Radiant',
  'Mystic', 'Electric', 'Stellar', 'Digital', 'Ghost', 'Shadow', 'Ruby', 'Sapphire',
  'Astral', 'Lucid', 'Quantum', 'Sonic', 'Hyper', 'Cyber'
]

const NOUNS = [
  'Harmony', 'Wave', 'Horizon', 'Echo', 'Nexus', 'Pulse', 'Aura', 'Zenith',
  'Nova', 'Vortex', 'Prism', 'Vertex', 'Matrix', 'Engine', 'Core', 'Relay',
  'Bridge', 'Proxy', 'Gateway', 'Signal', 'Station', 'Beacon', 'Forge', 'Node',
  'Stream', 'Flow', 'Link', 'Cloud', 'Grid', 'Sphere'
]

function generateRandomName () {
  const adj = ADJECTIVES[crypto.randomInt(ADJECTIVES.length)]
  const noun = NOUNS[crypto.randomInt(NOUNS.length)]
  const num = crypto.randomInt(10, 999)
  return `${adj} ${noun} ${num}`
}

// ── Runtime config (editable from UI) ────────────────────────────
// Keys that can be changed at runtime via the settings page.
// Precedence: saved (settings.json) > env var > built-in fallback.
// The env var values serve as *defaults*, not locks.
const EDITABLE_KEYS = {
  appName: { env: 'APP_NAME', fallback: generateRandomName(), type: 'string' },
  appVersion: { env: 'APP_VERSION', fallback: '0.3.0', type: 'string' },
  appContact: { env: 'APP_CONTACT', fallback: `contact-${crypto.randomBytes(4).toString('hex')}@example.com`, type: 'string' },
  cacheTtlSeconds: { env: 'CACHE_TTL_SECONDS', fallback: 86400, type: 'number' },
  musicbrainzBaseUrl: { env: 'MUSICBRAINZ_BASE_URL', fallback: 'https://musicbrainz.org/ws/2', type: 'string' },
  musicbrainzApiKey: { env: 'MUSICBRAINZ_API_KEY', fallback: '', type: 'string' },
  musicbrainzIpFamily: { env: 'MUSICBRAINZ_IP_FAMILY', fallback: 'auto', type: 'string' },
  minRequestIntervalMs: { env: 'MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS', fallback: 1100, type: 'number' },
  upstreamTimeoutMs: { env: 'UPSTREAM_TIMEOUT_MS', fallback: 8000, type: 'number' },
  upstreamMaxAttempts: { env: 'UPSTREAM_MAX_ATTEMPTS', fallback: 3, type: 'number' },
  upstreamRetryBaseMs: { env: 'UPSTREAM_RETRY_BASE_MS', fallback: 500, type: 'number' },
  upstreamRetryMaxMs: { env: 'UPSTREAM_RETRY_MAX_MS', fallback: 30000, type: 'number' },
  slowRequestMs: { env: 'SLOW_REQUEST_MS', fallback: 2000, type: 'number' },
  metadataProviders: { env: 'METADATA_PROVIDERS', fallback: 'musicbrainz,itunes', type: 'string' },
  lastfmApiKey: { env: 'LASTFM_API_KEY', fallback: '', type: 'string' },
  discogsToken: { env: 'DISCOGS_TOKEN', fallback: '', type: 'string' },
  theAudioDbApiKey: { env: 'THEAUDIODB_API_KEY', fallback: '', type: 'string' },
  itunesCountry: { env: 'ITUNES_COUNTRY', fallback: 'US', type: 'string' },
  customProviderName: { env: 'CUSTOM_PROVIDER_NAME', fallback: 'Custom API', type: 'string' },
  customProviderBaseUrl: { env: 'CUSTOM_PROVIDER_BASE_URL', fallback: '', type: 'string' },
  customProviderSearchPath: { env: 'CUSTOM_PROVIDER_SEARCH_PATH', fallback: '', type: 'string' },
  customProviderQueryParam: { env: 'CUSTOM_PROVIDER_QUERY_PARAM', fallback: 'q', type: 'string' },
  customProviderAuthType: { env: 'CUSTOM_PROVIDER_AUTH_TYPE', fallback: 'none', type: 'string' },
  customProviderHeaderName: { env: 'CUSTOM_PROVIDER_HEADER_NAME', fallback: '', type: 'string' },
  customProviderQueryAuthName: { env: 'CUSTOM_PROVIDER_QUERY_AUTH_NAME', fallback: '', type: 'string' },
  customProviderToken: { env: 'CUSTOM_PROVIDER_TOKEN', fallback: '', type: 'string' },
  customProviderMapping: { env: 'CUSTOM_PROVIDER_MAPPING', fallback: '{}', type: 'string' },
  providerPriority: { env: 'PROVIDER_PRIORITY', fallback: '', type: 'string' }
}

function getRuntimeConfig () {
  const config = {}

  for (const [key, spec] of Object.entries(EDITABLE_KEYS)) {
    const storedValue = settings.runtime?.[key]
    const envValue = process.env[spec.env]

    if (storedValue !== undefined) {
      // Saved value always wins — user explicitly set it
      config[key] = { value: storedValue, source: 'saved' }
    } else if (envValue !== undefined && envValue !== '') {
      // Env var as the default (editable)
      config[key] = { value: spec.type === 'number' ? Number(envValue) : envValue, source: 'default' }
    } else {
      config[key] = { value: spec.fallback, source: 'default' }
    }
  }

  return config
}

function getConfigValue (key) {
  const spec = EDITABLE_KEYS[key]

  if (!spec) {
    return undefined
  }

  // Saved values always win
  if (settings.runtime?.[key] !== undefined) {
    return settings.runtime[key]
  }

  const envValue = process.env[spec.env]

  if (envValue !== undefined && envValue !== '') {
    return spec.type === 'number' ? Number(envValue) : envValue
  }

  return spec.fallback
}

function updateRuntimeConfig (updates) {
  const applied = {}
  const cleared = {}
  const skipped = {}

  for (const [key, value] of Object.entries(updates)) {
    const spec = EDITABLE_KEYS[key]

    if (!spec) {
      skipped[key] = 'Unknown setting'
      continue
    }

    // null is the explicit clear-saved-override sentinel. The saved value is
    // removed and getConfigValue falls back to env (or built-in fallback).
    if (value === null) {
      cleared[key] = true
      continue
    }

    const coerced = spec.type === 'number' ? Number(value) : String(value)

    if (spec.type === 'number' && (Number.isNaN(coerced) || coerced <= 0)) {
      skipped[key] = 'Must be a positive number'
      continue
    }

    applied[key] = coerced
  }

  const hasApplied = Object.keys(applied).length > 0
  const hasCleared = Object.keys(cleared).length > 0

  if (hasApplied || hasCleared) {
    const nextRuntime = { ...settings.runtime, ...applied }
    for (const key of Object.keys(cleared)) {
      delete nextRuntime[key]
    }
    saveSettings({ ...settings, runtime: nextRuntime })
  }

  return { applied, cleared, skipped }
}

function clearRuntimeOverride (key) {
  const spec = EDITABLE_KEYS[key]

  if (!spec) {
    return { ok: false, reason: 'unknown_key' }
  }

  reloadSettings()

  const hadOverride = settings.runtime?.[key] !== undefined
  if (!hadOverride) {
    return {
      ok: true,
      cleared: false,
      key,
      newValue: getConfigValue(key),
      newSource: process.env[spec.env] !== undefined && process.env[spec.env] !== '' ? 'env' : 'default'
    }
  }

  const nextRuntime = { ...settings.runtime }
  delete nextRuntime[key]
  saveSettings({ ...settings, runtime: nextRuntime })

  return {
    ok: true,
    cleared: true,
    key,
    newValue: getConfigValue(key),
    newSource: process.env[spec.env] !== undefined && process.env[spec.env] !== '' ? 'env' : 'default'
  }
}

// Returns the list of editable keys whose saved runtime override differs from
// the current env value. Used at boot to log a warning so operators see at a
// glance which settings their env vars are NOT controlling.
function getEnvShadowedKeys () {
  reloadSettings()
  const out = []

  for (const [key, spec] of Object.entries(EDITABLE_KEYS)) {
    const saved = settings.runtime?.[key]
    if (saved === undefined) continue

    const envRaw = process.env[spec.env]
    const envValue = envRaw === undefined || envRaw === '' ? undefined : (spec.type === 'number' ? Number(envRaw) : envRaw)

    // Only report when env is set AND differs from saved. If env is unset,
    // saved is just acting as a default — nothing surprising to warn about.
    if (envValue !== undefined && envValue !== saved) {
      out.push({ key, savedValue: saved, envValue, envName: spec.env })
    }
  }

  return out
}

module.exports = {
  bootstrapAdminPassword,
  canBootstrapAdmin,
  checkApiKey,
  clearRuntimeOverride,
  createApiKey,
  deleteApiKey,
  generateRandomName,
  getConfigValue,
  getEnvShadowedKeys,
  getRuntimeConfig,
  getSessionSecret,
  hasAdminPassword,
  listApiKeys,
  resetPassword,
  updateRuntimeConfig,
  verifyPassword
}

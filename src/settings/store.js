const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const metrics = require('../metrics')

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

const versionsDir = path.join(dataDir, 'settings.versions')
const indexFile = path.join(versionsDir, 'index.json')
const MAX_VERSIONS = Number(process.env.SETTINGS_VERSION_MAX) || 50
const VERSION_ID_RE = /^\d{13}-[a-f0-9]{8,32}$/

let writePromise = Promise.resolve()

function createVersionId () {
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`
}

function isValidSettingsVersionId (versionId) {
  return typeof versionId === 'string' && VERSION_ID_RE.test(versionId)
}

function assertValidSettingsVersionId (versionId) {
  if (!isValidSettingsVersionId(versionId)) {
    throw new Error('Invalid versionId')
  }
}

function getVersionPath (versionId) {
  assertValidSettingsVersionId(versionId)
  const base = path.resolve(versionsDir) + path.sep
  const resolved = path.resolve(versionsDir, `${versionId}.json`)
  if (!resolved.startsWith(base)) {
    throw new Error('Invalid versionId')
  }
  return resolved
}

async function writeAtomic (filePath, data) {
  const tmpPath = `${filePath}.tmp.${crypto.randomBytes(4).toString('hex')}`
  let fh
  let renamed = false

  try {
    fh = await fs.promises.open(tmpPath, 'w', 0o600)
    try {
      await fh.writeFile(data)
      await fh.sync()
    } finally {
      if (fh) {
        await fh.close()
      }
    }

    await fs.promises.rename(tmpPath, filePath)
    renamed = true
  } finally {
    if (!renamed) {
      try {
        await fs.promises.unlink(tmpPath)
      } catch (err) {
        if (err.code !== 'ENOENT') {
          const logger = require('../utils/logger')
          logger.warn('Failed to remove temp settings file', { tmpPath, error: err.message })
        }
      }
    }
  }

  try {
    const dirPath = path.dirname(filePath)
    const dirFh = await fs.promises.open(dirPath, 'r')
    try {
      await dirFh.sync()
    } finally {
      await dirFh.close()
    }
  } catch (err) {
    // Ignore error if directory cannot be opened for syncing (e.g. windows)
  }
}

async function getSettingsVersions () {
  try {
    const data = await fs.promises.readFile(indexFile, 'utf8')
    return JSON.parse(data)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      const logger = require('../utils/logger')
      logger.error('Settings index corrupted or unreadable. Starting fresh history to recover.', { error: err.message })
    }
    return { current: null, lastKnownGood: null, versions: [] }
  }
}

function validateSettings (config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Settings must be an object')
  }
  if (config.runtime) {
    for (const [key, value] of Object.entries(config.runtime)) {
      const spec = EDITABLE_KEYS[key]
      if (!spec) {
        throw new Error(`Unknown setting key: ${key}`)
      }
      if (spec.type === 'number') {
        const coerced = Number(value)
        if (Number.isNaN(coerced) || coerced <= 0) {
          throw new Error(`Invalid number for ${key}: ${value}`)
        }
      }
    }
  }
}

async function commitSettingsVersion (nextSettings, reason = 'auto', actor = 'system') {
  validateSettings(nextSettings)
  await fs.promises.mkdir(versionsDir, { recursive: true })

  const id = createVersionId()
  const versionPath = getVersionPath(id)
  const data = JSON.stringify(nextSettings, null, 2)
  const hash = crypto.createHash('sha256').update(data).digest('hex')
  const size = Buffer.byteLength(data, 'utf8')

  await writeAtomic(versionPath, data)

  const index = await getSettingsVersions()
  const newEntry = {
    id,
    timestamp: new Date(Number(id.split('-')[0])).toISOString(),
    hash,
    size,
    reason,
    actor
  }

  index.versions.push(newEntry)
  index.current = id
  if (!index.lastKnownGood) {
    index.lastKnownGood = id
  }

  while (index.versions.length > MAX_VERSIONS) {
    const removableIndex = index.versions.findIndex((v) => v.id !== index.current && v.id !== index.lastKnownGood)
    const indexToRemove = removableIndex === -1
      ? index.versions.findIndex((v) => v.id !== index.current)
      : removableIndex

    if (indexToRemove === -1) break

    const [removed] = index.versions.splice(indexToRemove, 1)
    if (removed.id === index.lastKnownGood) {
      index.lastKnownGood = index.current
    }
    if (isValidSettingsVersionId(removed.id)) {
      fs.promises.unlink(getVersionPath(removed.id)).catch(() => {})
    }
  }

  await writeAtomic(indexFile, JSON.stringify(index, null, 2))
  return id
}

async function getSettingsVersion (versionId) {
  assertValidSettingsVersionId(versionId)
  const index = await getSettingsVersions()
  const meta = index.versions.find(v => v.id === versionId)

  if (!meta) {
    throw new Error(`Version ${versionId} not found`)
  }

  let data
  try {
    data = await fs.promises.readFile(getVersionPath(versionId), 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Version ${versionId} not found`)
    }
    throw err
  }
  const versionSettings = JSON.parse(data)
  validateSettings(versionSettings)
  return { meta, settings: versionSettings }
}

function computeDiff (current, target) {
  const diff = { changedKeys: [], added: [], removed: [] }
  const currentFlat = flattenConfig(current)
  const targetFlat = flattenConfig(target)

  const allKeys = new Set([...Object.keys(currentFlat), ...Object.keys(targetFlat)])
  for (const key of allKeys) {
    if (!(key in currentFlat)) diff.added.push(key)
    else if (!(key in targetFlat)) diff.removed.push(key)
    else if (JSON.stringify(currentFlat[key]) !== JSON.stringify(targetFlat[key])) diff.changedKeys.push(key)
  }
  return diff
}

function flattenConfig (obj, prefix = '') {
  return Object.keys(obj || {}).reduce((acc, k) => {
    const pre = prefix.length ? prefix + '.' : ''
    if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
      Object.assign(acc, flattenConfig(obj[k], pre + k))
    } else {
      acc[pre + k] = obj[k]
    }
    return acc
  }, {})
}

function saveSettingsFile (nextSettings, reason = 'auto', actor = 'system', { skipVersioning = false } = {}) {
  writePromise = writePromise.then(async () => {
    try {
      if (metrics.recordSettingsWrite) metrics.recordSettingsWrite()
      await fs.promises.mkdir(dataDir, { recursive: true })

      const data = `${JSON.stringify(nextSettings, null, 2)}\n`
      await writeAtomic(settingsPath, data)
      if (!skipVersioning) {
        await commitSettingsVersion(nextSettings, reason, actor)
      }
    } catch (err) {
      const logger = require('../utils/logger')
      logger.error('Failed to save settings file', { error: err.message })
    }
  })
  return writePromise
}

function markLastKnownGood () {
  writePromise = writePromise.then(async () => {
    try {
      const index = await getSettingsVersions()
      if (index.current && index.lastKnownGood !== index.current) {
        index.lastKnownGood = index.current
        await writeAtomic(indexFile, JSON.stringify(index, null, 2))
      }
    } catch (err) {
      // Ignore
    }
  })
  return writePromise
}

async function rollbackSettings (versionId, dryRun = false, actor = 'operator') {
  assertValidSettingsVersionId(versionId)
  // We need to pause normal writes while doing rollback.
  // Wait for any pending writes to complete, then execute our block.
  return new Promise((resolve, reject) => {
    writePromise = writePromise.then(async () => {
      const cancelDebouncedSave = () => {
        if (saveTimeout) {
          clearTimeout(saveTimeout)
          saveTimeout = null
        }
      }
      try {
        cancelDebouncedSave()

        const index = await getSettingsVersions()
        const targetVersion = index.versions.find(v => v.id === versionId)
        if (!targetVersion) {
          throw new Error(`Version ${versionId} not found`)
        }

        const { settings: targetSettings } = await getSettingsVersion(versionId)

        const diff = computeDiff(settings, targetSettings)

        const previousVersion = index.current

        if (dryRun) {
          return resolve({ ok: true, dryRun: true, diff, previousVersion })
        }

        cancelDebouncedSave()
        settings = targetSettings
        if (metrics.recordSettingsWrite) metrics.recordSettingsWrite()
        await fs.promises.mkdir(dataDir, { recursive: true })
        await writeAtomic(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)

        await commitSettingsVersion(settings, `rollback to ${versionId}`, actor)
        cancelDebouncedSave()

        resolve({ ok: true, dryRun: false, diff, rolledBackTo: versionId, previousVersion })
      } catch (err) {
        reject(err)
      }
    }).catch(reject) // Catching any top-level errors in the promise chain
  })
}

async function getCurrentSettingsVersion () {
  const index = await getSettingsVersions()
  return index.current
}

function saveSettings (nextSettings) {
  settings = nextSettings
  return saveSettingsFile(settings)
}

let saveTimeout = null
function saveSettingsDebounced (nextSettings, { skipVersioning = false } = {}) {
  settings = nextSettings
  if (metrics.recordSettingsDebounce) metrics.recordSettingsDebounce()
  if (!saveTimeout) {
    saveTimeout = setTimeout(() => {
      saveTimeout = null
      saveSettingsFile(settings, 'auto', 'system', { skipVersioning })
    }, 2000)
    if (saveTimeout.unref) saveTimeout.unref()
  }
}

async function flushSettingsWrites () {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
    await saveSettingsFile(settings)
  }
  return writePromise
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

const INTERNAL_VALIDATOR_KEY_TTL_MS = 15 * 60 * 1000
const internalValidatorKeys = new Map()

function pruneExpiredInternalValidatorKeys (now = Date.now()) {
  for (const [key, expiresAt] of internalValidatorKeys.entries()) {
    if (expiresAt <= now) {
      internalValidatorKeys.delete(key)
    }
  }
}

function setInternalValidatorKey (key) {
  if (key === null || key === undefined || key === '') {
    return
  }
  const now = Date.now()
  pruneExpiredInternalValidatorKeys(now)
  internalValidatorKeys.set(key, now + INTERNAL_VALIDATOR_KEY_TTL_MS)
}

function clearInternalValidatorKey (key) {
  if (key) {
    internalValidatorKeys.delete(key)
  }
}

function isInternalValidatorKey (apiKey) {
  const now = Date.now()
  pruneExpiredInternalValidatorKeys(now)

  return internalValidatorKeys.has(apiKey)
}

function checkApiKey (apiKey) {
  if (isInternalValidatorKey(apiKey)) {
    return { valid: true, id: 'internal', name: 'validator' }
  }
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
  }, { skipVersioning: true })

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
    saveSettingsDebounced({ ...settings, runtime: nextRuntime })
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
  saveSettingsDebounced({ ...settings, runtime: nextRuntime })

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

async function validateConfigInMemory (updates, validatorFn) {
  const applied = {}
  for (const [key, value] of Object.entries(updates)) {
    const spec = EDITABLE_KEYS[key]
    if (!spec) continue
    if (value === null) {
      applied[key] = null
    } else {
      const coerced = spec.type === 'number' ? Number(value) : String(value)
      if (spec.type === 'number' && (Number.isNaN(coerced) || coerced <= 0)) continue
      applied[key] = coerced
    }
  }

  const nextRuntime = { ...settings.runtime }
  for (const [key, value] of Object.entries(applied)) {
    if (value === null) delete nextRuntime[key]
    else nextRuntime[key] = value
  }

  const previousSettings = settings
  const nextSettings = { ...settings, runtime: nextRuntime }
  const diff = computeDiff(previousSettings, nextSettings)

  // Swap in the proposed settings for the duration of the validator only.
  // No disk writes happen here — saveSettingsFile/saveSettingsDebounced are
  // not called, so the version history and on-disk settings.json stay
  // untouched even if the canary runs against the new values.
  settings = nextSettings
  try {
    const result = await validatorFn(nextSettings, diff)
    return { ...result, diff }
  } finally {
    settings = previousSettings
  }
}

module.exports = {
  bootstrapAdminPassword,
  canBootstrapAdmin,
  checkApiKey,
  clearRuntimeOverride,
  createApiKey,
  deleteApiKey,
  flushSettingsWrites,
  generateRandomName,
  getConfigValue,
  getEnvShadowedKeys,
  getRuntimeConfig,
  getSessionSecret,
  hasAdminPassword,
  listApiKeys,
  resetPassword,
  updateRuntimeConfig,
  verifyPassword,
  getSettingsVersions,
  getSettingsVersion,
  getCurrentSettingsVersion,
  rollbackSettings,
  markLastKnownGood,
  computeDiff,
  isValidSettingsVersionId,
  setInternalValidatorKey,
  clearInternalValidatorKey,
  validateConfigInMemory,
  validateSettings
}

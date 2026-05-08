const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'melodarr-test-'))
process.env.DATA_DIR = testDataDir

// Write an invalid JSON to trigger the catch block in loadSettings
fs.writeFileSync(path.join(testDataDir, 'settings.json'), '{ invalid json')

const store = require('./store')

function loadFreshStore ({ maxVersions } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'melodarr-version-test-'))
  const storePath = require.resolve('./store')
  const previousDataDir = process.env.DATA_DIR
  const previousMaxVersions = process.env.SETTINGS_VERSION_MAX

  delete require.cache[storePath]
  process.env.DATA_DIR = dir
  if (maxVersions !== undefined) {
    process.env.SETTINGS_VERSION_MAX = String(maxVersions)
  } else {
    delete process.env.SETTINGS_VERSION_MAX
  }

  const freshStore = require('./store')

  return {
    dir,
    store: freshStore,
    cleanup () {
      delete require.cache[storePath]
      if (previousDataDir === undefined) {
        delete process.env.DATA_DIR
      } else {
        process.env.DATA_DIR = previousDataDir
      }
      if (previousMaxVersions === undefined) {
        delete process.env.SETTINGS_VERSION_MAX
      } else {
        process.env.SETTINGS_VERSION_MAX = previousMaxVersions
      }
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

test('Store Module', async (t) => {
  t.after(() => {
    fs.rmSync(testDataDir, { recursive: true, force: true })
  })

  await t.test('generateRandomName returns a string with two words and a number', () => {
    const name = store.generateRandomName()
    assert.strictEqual(typeof name, 'string')
    const parts = name.split(' ')
    assert.strictEqual(parts.length, 3)
    assert.ok(!isNaN(Number(parts[2])))
  })

  await t.test('getRuntimeConfig and getConfigValue', () => {
    const config = store.getRuntimeConfig()
    assert.ok(config.appName.value)

    const value = store.getConfigValue('appVersion')
    assert.strictEqual(value, '0.3.0') // fallback
  })

  await t.test('MusicBrainz IP family is fixed to IPv6 only', () => {
    process.env.MUSICBRAINZ_IP_FAMILY = '4'
    const result = store.updateRuntimeConfig({ musicbrainzIpFamily: 'auto' })

    const config = store.getRuntimeConfig()
    assert.strictEqual(result.applied.musicbrainzIpFamily, undefined)
    assert.strictEqual(result.skipped.musicbrainzIpFamily, 'Fixed setting')
    assert.strictEqual(config.musicbrainzIpFamily.value, '6')
    assert.strictEqual(config.musicbrainzIpFamily.source, 'fixed')
    assert.strictEqual(store.getConfigValue('musicbrainzIpFamily'), '6')

    delete process.env.MUSICBRAINZ_IP_FAMILY
  })

  await t.test('provider IP family settings only accept auto, 4, or 6', async () => {
    const invalid = store.updateRuntimeConfig({ itunesIpFamily: 'broken' })
    assert.strictEqual(invalid.applied.itunesIpFamily, undefined)
    assert.match(invalid.skipped.itunesIpFamily, /auto, 4, 6/)

    const valid = store.updateRuntimeConfig({ itunesIpFamily: '6', providerIpFamily: '4' })
    await store.flushSettingsWrites()
    assert.deepStrictEqual(valid.applied, { itunesIpFamily: '6', providerIpFamily: '4' })
    assert.strictEqual(store.getConfigValue('itunesIpFamily'), '6')
    assert.strictEqual(store.getConfigValue('providerIpFamily'), '4')

    store.updateRuntimeConfig({ itunesIpFamily: null, providerIpFamily: null })
    await store.flushSettingsWrites()
  })

  await t.test('provider request intervals have a default and per-provider overrides', async () => {
    const result = store.updateRuntimeConfig({
      providerMinRequestIntervalMs: '600',
      itunesMinRequestIntervalMs: '150',
      lastfmMinRequestIntervalMs: '250',
      discogsMinRequestIntervalMs: '1250',
      theAudioDbMinRequestIntervalMs: '900',
      customProviderMinRequestIntervalMs: '700'
    })
    await store.flushSettingsWrites()

    assert.deepStrictEqual(result.skipped, {})
    assert.strictEqual(store.getConfigValue('providerMinRequestIntervalMs'), 600)
    assert.strictEqual(store.getConfigValue('itunesMinRequestIntervalMs'), 150)
    assert.strictEqual(store.getConfigValue('lastfmMinRequestIntervalMs'), 250)
    assert.strictEqual(store.getConfigValue('discogsMinRequestIntervalMs'), 1250)
    assert.strictEqual(store.getConfigValue('theAudioDbMinRequestIntervalMs'), 900)
    assert.strictEqual(store.getConfigValue('customProviderMinRequestIntervalMs'), 700)

    store.updateRuntimeConfig({
      providerMinRequestIntervalMs: null,
      itunesMinRequestIntervalMs: null,
      lastfmMinRequestIntervalMs: null,
      discogsMinRequestIntervalMs: null,
      theAudioDbMinRequestIntervalMs: null,
      customProviderMinRequestIntervalMs: null
    })
    await store.flushSettingsWrites()
  })

  await t.test('getSessionSecret', () => {
    // Should fallback to empty or generated if not set initially
    assert.strictEqual(typeof store.getSessionSecret(), 'string')

    process.env.SETTINGS_SESSION_SECRET = 'env-secret'
    assert.strictEqual(store.getSessionSecret(), 'env-secret')
    delete process.env.SETTINGS_SESSION_SECRET

    process.env.ADMIN_PASSWORD = 'admin-env-secret'
    assert.strictEqual(store.getSessionSecret(), 'admin-env-secret')
    delete process.env.ADMIN_PASSWORD
  })

  await t.test('updateRuntimeConfig', () => {
    const updates = { appVersion: '0.4.0', unknownKey: 'value', cacheTtlSeconds: 'invalid' }
    const result = store.updateRuntimeConfig(updates)

    assert.deepStrictEqual(result.applied, { appVersion: '0.4.0' })
    assert.ok(result.skipped.unknownKey)
    assert.ok(result.skipped.cacheTtlSeconds)

    assert.strictEqual(store.getConfigValue('appVersion'), '0.4.0')
  })

  await t.test('updateRuntimeConfig with null clears the saved override', async () => {
    // First save a value.
    store.updateRuntimeConfig({ metadataProviders: 'musicbrainz,itunes,theaudiodb' })
    await store.flushSettingsWrites()
    assert.strictEqual(store.getConfigValue('metadataProviders'), 'musicbrainz,itunes,theaudiodb')

    // Then clear it via null sentinel.
    const result = store.updateRuntimeConfig({ metadataProviders: null })
    await store.flushSettingsWrites()
    assert.deepStrictEqual(result.cleared, { metadataProviders: true })
    assert.deepStrictEqual(result.applied, {})

    // After clearing, getConfigValue falls back to env or built-in fallback.
    delete process.env.METADATA_PROVIDERS
    assert.strictEqual(store.getConfigValue('metadataProviders'), 'musicbrainz,itunes')
  })

  await t.test('clearRuntimeOverride removes a saved value and reports new source', async () => {
    store.updateRuntimeConfig({ metadataProviders: 'discogs,itunes' })
    await store.flushSettingsWrites()
    assert.strictEqual(store.getConfigValue('metadataProviders'), 'discogs,itunes')

    process.env.METADATA_PROVIDERS = 'itunes,theaudiodb'
    const result = store.clearRuntimeOverride('metadataProviders')
    await store.flushSettingsWrites()
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.cleared, true)
    assert.strictEqual(result.newValue, 'itunes,theaudiodb')
    assert.strictEqual(result.newSource, 'env')
    assert.strictEqual(store.getConfigValue('metadataProviders'), 'itunes,theaudiodb')
    delete process.env.METADATA_PROVIDERS
  })

  await t.test('clearRuntimeOverride is a no-op when no override exists', () => {
    // Already cleared by the previous test.
    const result = store.clearRuntimeOverride('metadataProviders')
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.cleared, false)
  })

  await t.test('clearRuntimeOverride rejects unknown keys', () => {
    const result = store.clearRuntimeOverride('totallyMadeUpKey')
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.reason, 'unknown_key')
  })

  await t.test('getEnvShadowedKeys reports only when saved differs from env', async () => {
    // Saved differs from env → reported.
    store.updateRuntimeConfig({ metadataProviders: 'musicbrainz,theaudiodb,itunes,discogs' })
    await store.flushSettingsWrites()
    process.env.METADATA_PROVIDERS = 'itunes,theaudiodb,discogs'
    const shadowed = store.getEnvShadowedKeys()
    const entry = shadowed.find((s) => s.key === 'metadataProviders')
    assert.ok(entry, 'expected metadataProviders to be reported as shadowed')
    assert.strictEqual(entry.envName, 'METADATA_PROVIDERS')
    assert.strictEqual(entry.savedValue, 'musicbrainz,theaudiodb,itunes,discogs')
    assert.strictEqual(entry.envValue, 'itunes,theaudiodb,discogs')

    // Saved matches env → not reported.
    store.updateRuntimeConfig({ metadataProviders: 'itunes,theaudiodb,discogs' })
    await store.flushSettingsWrites()
    const shadowed2 = store.getEnvShadowedKeys()
    assert.strictEqual(shadowed2.find((s) => s.key === 'metadataProviders'), undefined)

    // Env unset → not reported (saved is just the default).
    delete process.env.METADATA_PROVIDERS
    const shadowed3 = store.getEnvShadowedKeys()
    assert.strictEqual(shadowed3.find((s) => s.key === 'metadataProviders'), undefined)
  })

  await t.test('API Keys management', async () => {
    const created = store.createApiKey({ name: 'Test Key', quotaPerMinute: 100 })
    await store.flushSettingsWrites()
    assert.ok(created.id)
    assert.ok(created.key.startsWith('mp_'))

    const keys = store.listApiKeys()
    const found = keys.find(k => k.id === created.id)
    assert.ok(found)
    assert.strictEqual(found.name, 'Test Key')
    assert.strictEqual(found.quotaPerMinute, 100)

    // Check API Key
    const checkResult = store.checkApiKey(created.key)
    assert.strictEqual(checkResult.valid, true)

    const invalidCheck = store.checkApiKey('mp_invalid')
    assert.strictEqual(invalidCheck.valid, false)

    // Delete API Key
    const deleted = store.deleteApiKey(created.id)
    await store.flushSettingsWrites()
    assert.strictEqual(deleted, true)

    const notDeleted = store.deleteApiKey('nonexistent')
    await store.flushSettingsWrites()
    assert.strictEqual(notDeleted, false)
  })

  await t.test('Admin Password', async () => {
    const canBootstrap = store.canBootstrapAdmin()
    assert.strictEqual(typeof canBootstrap, 'boolean')

    // Password reset
    const originalEnv = process.env.ADMIN_PASSWORD
    delete process.env.ADMIN_PASSWORD
    const resetResult = store.resetPassword()
    assert.strictEqual(typeof resetResult.cleared, 'boolean')

    // Bootstrap
    if (store.canBootstrapAdmin()) {
      store.bootstrapAdminPassword('password123')
      await store.flushSettingsWrites()
      assert.strictEqual(store.canBootstrapAdmin(), false)
      assert.strictEqual(store.hasAdminPassword(), true)
      assert.strictEqual(store.verifyPassword('password123'), true)
      assert.strictEqual(store.verifyPassword('wrong'), false)
    }

    process.env.ADMIN_PASSWORD = 'envpassword'
    assert.strictEqual(store.verifyPassword('envpassword'), true)
    assert.strictEqual(store.verifyPassword('wrong'), false)

    const envResetResult = store.resetPassword()
    assert.strictEqual(envResetResult.cleared, false)

    if (originalEnv) {
      process.env.ADMIN_PASSWORD = originalEnv
    } else {
      delete process.env.ADMIN_PASSWORD
    }
  })

  await t.test('Settings persistence debounces rapid updates (write coalescing)', async () => {
    const metrics = require('../metrics')

    // Reset stats for clean test
    metrics.stats.settings.writes = 0
    metrics.stats.settings.debounced = 0

    // Issue 5 rapid updates
    for (let i = 0; i < 5; i++) {
      store.updateRuntimeConfig({ appVersion: `test-coalesce-${i}` })
    }

    // Flush to ensure any pending write completes
    await store.flushSettingsWrites()

    const stats = metrics.getStats().settings
    assert.strictEqual(stats.writes, 1, 'Should only write once for rapid updates')
    assert.strictEqual(stats.debounced, 5, 'Should debounce 5 rapid updates')

    // Clean up
    store.clearRuntimeOverride('appVersion')
    await store.flushSettingsWrites()
  })
  await t.test('Settings versioning and rollback', async () => {
    store.updateRuntimeConfig({ appVersion: 'v1' })
    await store.flushSettingsWrites()
    const v1Id = await store.getCurrentSettingsVersion()

    store.updateRuntimeConfig({ appVersion: 'v2' })
    await store.flushSettingsWrites()
    const v2Id = await store.getCurrentSettingsVersion()

    assert.notStrictEqual(v1Id, v2Id)

    const rb1 = await store.rollbackSettings(v1Id, true) // dry run
    assert.strictEqual(rb1.ok, true)
    assert.strictEqual(rb1.dryRun, true)
    assert.strictEqual(rb1.previousVersion, v2Id)

    const rb2 = await store.rollbackSettings(v1Id)
    assert.strictEqual(rb2.ok, true)
    assert.strictEqual(rb2.rolledBackTo, v1Id)
    assert.strictEqual(rb2.previousVersion, v2Id)

    assert.strictEqual(store.getConfigValue('appVersion'), 'v1')
  })
})

test('settings version snapshots include metadata and track current version', async (t) => {
  const fresh = loadFreshStore()
  t.after(fresh.cleanup)

  fresh.store.updateRuntimeConfig({ appVersion: 'snapshot-v1' })
  await fresh.store.flushSettingsWrites()
  const firstVersion = await fresh.store.getCurrentSettingsVersion()

  fresh.store.updateRuntimeConfig({ appVersion: 'snapshot-v2' })
  await fresh.store.flushSettingsWrites()
  const secondVersion = await fresh.store.getCurrentSettingsVersion()

  assert.match(firstVersion, /^\d{13}-[a-f0-9]{16}$/)
  assert.match(secondVersion, /^\d{13}-[a-f0-9]{16}$/)
  assert.notEqual(firstVersion, secondVersion)

  const index = await fresh.store.getSettingsVersions()
  assert.equal(index.current, secondVersion)
  assert.equal(index.lastKnownGood, firstVersion)
  assert.equal(index.versions.length, 2)

  const secondMeta = index.versions.find((version) => version.id === secondVersion)
  assert.equal(secondMeta.reason, 'auto')
  assert.equal(secondMeta.actor, 'system')
  assert.equal(typeof secondMeta.hash, 'string')
  assert.ok(secondMeta.size > 0)
  assert.equal(new Date(secondMeta.timestamp).toISOString(), secondMeta.timestamp)

  const versionFile = path.join(fresh.dir, 'settings.versions', `${secondVersion}.json`)
  assert.equal(fs.existsSync(versionFile), true)
})

test('settings version retention keeps at most 50 versions', async (t) => {
  const fresh = loadFreshStore({ maxVersions: 50 })
  t.after(fresh.cleanup)

  for (let i = 0; i < 55; i++) {
    fresh.store.updateRuntimeConfig({ appVersion: `retained-${i}` })
    await fresh.store.flushSettingsWrites()
  }

  const index = await fresh.store.getSettingsVersions()
  assert.equal(index.versions.length, 50)
  assert.equal(index.versions.some((version) => version.id === index.current), true)
  assert.equal(index.versions.some((version) => version.id === index.lastKnownGood), true)
})

test('settings rollback supports dry-run and records a new current version on success', async (t) => {
  const fresh = loadFreshStore()
  t.after(fresh.cleanup)

  fresh.store.updateRuntimeConfig({ appVersion: 'rollback-v1' })
  await fresh.store.flushSettingsWrites()
  const v1 = await fresh.store.getCurrentSettingsVersion()

  fresh.store.updateRuntimeConfig({ appVersion: 'rollback-v2' })
  await fresh.store.flushSettingsWrites()
  const v2 = await fresh.store.getCurrentSettingsVersion()

  const dryRun = await fresh.store.rollbackSettings(v1, true, 'test')
  assert.equal(dryRun.ok, true)
  assert.equal(dryRun.dryRun, true)
  assert.equal(dryRun.previousVersion, v2)
  assert.equal(fresh.store.getConfigValue('appVersion'), 'rollback-v2')
  assert.equal(await fresh.store.getCurrentSettingsVersion(), v2)

  const rollback = await fresh.store.rollbackSettings(v1, false, 'test')
  assert.equal(rollback.ok, true)
  assert.equal(rollback.rolledBackTo, v1)
  assert.equal(rollback.previousVersion, v2)
  assert.equal(fresh.store.getConfigValue('appVersion'), 'rollback-v1')

  const current = await fresh.store.getCurrentSettingsVersion()
  assert.notEqual(current, v1)
  assert.notEqual(current, v2)

  const index = await fresh.store.getSettingsVersions()
  const currentMeta = index.versions.find((version) => version.id === current)
  assert.equal(currentMeta.reason, `rollback to ${v1}`)
  assert.equal(currentMeta.actor, 'test')
})

test('settings rollback rejects malformed, missing, and invalid stored versions', async (t) => {
  const fresh = loadFreshStore()
  t.after(fresh.cleanup)

  fresh.store.updateRuntimeConfig({ appVersion: 'safe-before-invalid' })
  await fresh.store.flushSettingsWrites()

  await assert.rejects(
    fresh.store.rollbackSettings('../settings.json'),
    /Invalid versionId/
  )

  await assert.rejects(
    fresh.store.rollbackSettings('1700000000000-1234567890abcdef'),
    /Version 1700000000000-1234567890abcdef not found/
  )

  const badId = '1700000000001-1234567890abcdef'
  const versionsDir = path.join(fresh.dir, 'settings.versions')
  fs.mkdirSync(versionsDir, { recursive: true })
  fs.writeFileSync(
    path.join(versionsDir, `${badId}.json`),
    JSON.stringify({ runtime: { definitelyNotASetting: true } })
  )
  fs.writeFileSync(
    path.join(versionsDir, 'index.json'),
    JSON.stringify({
      current: badId,
      lastKnownGood: badId,
      versions: [{ id: badId, timestamp: new Date().toISOString(), hash: 'x', size: 1, reason: 'test', actor: 'test' }]
    })
  )

  await assert.rejects(
    fresh.store.rollbackSettings(badId),
    /Unknown setting key: definitelyNotASetting/
  )
})

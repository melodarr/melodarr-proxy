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

  await t.test('API Keys management', () => {
    const created = store.createApiKey({ name: 'Test Key', quotaPerMinute: 100 })
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
    assert.strictEqual(deleted, true)

    const notDeleted = store.deleteApiKey('nonexistent')
    assert.strictEqual(notDeleted, false)
  })

  await t.test('Admin Password', () => {
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
})

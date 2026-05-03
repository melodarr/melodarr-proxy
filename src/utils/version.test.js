const test = require('node:test')
const assert = require('node:assert/strict')

const { getAppVersion } = require('./version')

const pkgVersion = require('../../package.json').version

function withEnv (value, fn) {
  const prev = process.env.APP_VERSION
  if (value === undefined) {
    delete process.env.APP_VERSION
  } else {
    process.env.APP_VERSION = value
  }
  try {
    return fn()
  } finally {
    if (prev === undefined) {
      delete process.env.APP_VERSION
    } else {
      process.env.APP_VERSION = prev
    }
  }
}

test('getAppVersion — vlatest falls back to package.json version', () => {
  assert.equal(withEnv('vlatest', getAppVersion), pkgVersion)
})

test('getAppVersion — vLatest (mixed case) falls back to package.json version', () => {
  assert.equal(withEnv('vLatest', getAppVersion), pkgVersion)
})

test('getAppVersion — Latest (no v prefix, mixed case) falls back to package.json version', () => {
  assert.equal(withEnv('Latest', getAppVersion), pkgVersion)
})

test('getAppVersion — latest falls back to package.json version', () => {
  assert.equal(withEnv('latest', getAppVersion), pkgVersion)
})

test('getAppVersion — unknown falls back to package.json version', () => {
  assert.equal(withEnv('unknown', getAppVersion), pkgVersion)
})

test('getAppVersion — VUNKNOWN (uppercase with v prefix) falls back to package.json version', () => {
  assert.equal(withEnv('VUNKNOWN', getAppVersion), pkgVersion)
})

test('getAppVersion — " unknown " (with surrounding whitespace) falls back to package.json version', () => {
  assert.equal(withEnv(' unknown ', getAppVersion), pkgVersion)
})

test('getAppVersion — v0.3.0 returns the version string as-is', () => {
  assert.equal(withEnv('v0.3.0', getAppVersion), 'v0.3.0')
})

test('getAppVersion — version with surrounding whitespace is trimmed', () => {
  assert.equal(withEnv(' v1.2.3 ', getAppVersion), 'v1.2.3')
})

test('getAppVersion — no APP_VERSION set falls back to package.json version', () => {
  assert.equal(withEnv(undefined, getAppVersion), pkgVersion)
})

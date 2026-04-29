const assert = require('node:assert/strict')
const test = require('node:test')
const { compareVersions } = require('./update.controller')

test('compareVersions handles release tag prefixes and semver parts', () => {
  assert.equal(compareVersions('v0.3.0', '0.2.0'), 1)
  assert.equal(compareVersions('0.2.0', 'v0.2.0'), 0)
  assert.equal(compareVersions('0.2.0', '0.2.1'), -1)
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
})

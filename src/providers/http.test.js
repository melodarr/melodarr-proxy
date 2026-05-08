const test = require('node:test')
const assert = require('node:assert/strict')

const {
  httpsAgent,
  getProviderHttpsAgent,
  normalizeProviderIpFamily,
  pickLargestImage
} = require('./http')

test('normalizeProviderIpFamily maps supported values and falls back to auto', () => {
  assert.equal(normalizeProviderIpFamily('4'), 4)
  assert.equal(normalizeProviderIpFamily('6'), 6)
  assert.equal(normalizeProviderIpFamily('auto'), 'auto')
  assert.equal(normalizeProviderIpFamily('invalid'), 'auto')
  assert.equal(normalizeProviderIpFamily(undefined), 'auto')
})

test('getProviderHttpsAgent caches one agent per configured IP family', () => {
  const autoAgent = getProviderHttpsAgent('auto')
  const v4Agent = getProviderHttpsAgent('4')
  const v6Agent = getProviderHttpsAgent('6')

  assert.equal(httpsAgent, autoAgent)
  assert.equal(getProviderHttpsAgent('auto'), autoAgent)
  assert.equal(getProviderHttpsAgent('invalid'), autoAgent)
  assert.equal(getProviderHttpsAgent('4'), v4Agent)
  assert.equal(getProviderHttpsAgent('6'), v6Agent)

  assert.equal(autoAgent.options.family, undefined)
  assert.equal(v4Agent.options.family, 4)
  assert.equal(v6Agent.options.family, 6)
})

test('pickLargestImage keeps Last.fm largest image behavior', () => {
  assert.equal(pickLargestImage(null), '')
  assert.equal(pickLargestImage([{ '#text': 'small' }, { '#text': 'large' }]), 'large')
})

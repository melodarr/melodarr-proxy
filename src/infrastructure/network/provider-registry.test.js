const test = require('node:test')
const assert = require('node:assert')

const { getProviderTransport } = require('./provider-registry')

test('provider-registry — lastfm.buildUrl injects api_key when configured', () => {
  const lastfm = getProviderTransport('lastfm')
  assert.strictEqual(typeof lastfm.buildUrl, 'function')
  assert.strictEqual(lastfm.requiresAuth, true)
  assert.strictEqual(lastfm.authConfigKey, 'lastfmApiKey')

  const url = lastfm.buildUrl((key) => (key === 'lastfmApiKey' ? 'SECRET-KEY-123' : ''))
  assert.strictEqual(url.searchParams.get('api_key'), 'SECRET-KEY-123')
  assert.strictEqual(url.hostname, 'ws.audioscrobbler.com')
})

test('provider-registry — lastfm.buildUrl omits api_key when missing', () => {
  const lastfm = getProviderTransport('lastfm')
  const url = lastfm.buildUrl(() => '')
  assert.strictEqual(url.searchParams.has('api_key'), false)
})

test('provider-registry — discogs.buildUrl injects token when configured', () => {
  const discogs = getProviderTransport('discogs')
  assert.strictEqual(typeof discogs.buildUrl, 'function')
  assert.strictEqual(discogs.requiresAuth, false)

  const url = discogs.buildUrl((key) => (key === 'discogsToken' ? 'token-abc' : ''))
  assert.strictEqual(url.searchParams.get('token'), 'token-abc')
})

test('provider-registry — discogs allows anonymous probes (requiresAuth=false)', () => {
  const discogs = getProviderTransport('discogs')
  const url = discogs.buildUrl(() => '')
  assert.strictEqual(url.searchParams.has('token'), false)
})

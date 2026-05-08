const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const controllerDir = path.dirname(require.resolve('./debug.controller'))

const heavyStubs = {
  '../tracer': { createTrace: () => ({}), addStep () {}, finalizeTrace: async () => {} },
  '../cache': {
    isReady: async () => false,
    getHealth: () => 'ok',
    getStats: () => ({}),
    isRedisHealthy: false,
    get: async () => null,
    set: async () => {}
  },
  '../metrics': { state: { isRunning: true }, providerStats: new Map(), getStats: () => ({ providers: {} }) },
  '../providers': { aggregateArtist: async () => ({}) },
  '../providers/artist-discovery': { discoverArtists: async () => [], findSongAlbums: async () => ({}) },
  '../ranking/engine': { rankResults: () => ({ results: [], debug: {} }) },
  '../enrichment/pipeline': { enrichResult: async (r) => r },
  '../snapshots': { getSnapshots: async () => [] },
  './health.controller': { buildHealthPayload: () => ({ status: 'ok' }) },
  '../providers/custom.provider': { testCustomProvider: async () => ({}) },
  '../settings/store': { getConfigValue: () => null },
  '../services/diagnose.service': {
    diagnoseMusicBrainz: async () => ({}),
    diagnoseGenericProvider: async (provider) => ({
      provider,
      ok: provider === 'itunes',
      failedStep: provider === 'itunes' ? null : 'http'
    })
  },
  '../diagnostics/upstream-buffer': { query: () => ({ entries: [], filteredCount: 0, totalCount: 0, maxSize: 100 }) },
  '../utils/dates': { toIsoDate: (v) => String(v || '') },
  '../utils/logger': { error () {}, warn () {}, info () {}, debug () {} },
  '../infrastructure/network/network-diagnostics.service': {
    getNetworkDiagnostics: async ({ refresh } = {}) => ({
      status: refresh ? 'ok' : 'unknown',
      providers: {
        musicbrainz: {
          provider: 'musicbrainz',
          policy: 'ipv6_only',
          family: 6,
          fallbackAllowed: false,
          state: refresh ? 'MUSICBRAINZ_IPV6_HEALTHY' : 'UNKNOWN'
        },
        itunes: {
          provider: 'itunes',
          policy: 'auto',
          family: 'auto',
          fallbackAllowed: true,
          state: refresh ? 'HEALTHY' : 'UNKNOWN'
        }
      },
      summary: {
        musicbrainz: {
          policy: 'ipv6_only',
          family: 6,
          fallbackAllowed: false,
          state: refresh ? 'MUSICBRAINZ_IPV6_HEALTHY' : 'UNKNOWN'
        },
        itunes: {
          policy: 'auto',
          family: 'auto',
          fallbackAllowed: true,
          state: refresh ? 'HEALTHY' : 'UNKNOWN'
        }
      }
    })
  }
}

for (const [stubPath, exports] of Object.entries(heavyStubs)) {
  require.cache[require.resolve(stubPath, { paths: [controllerDir] })] = { exports }
}

delete require.cache[require.resolve('./debug.controller')]
const { getNetworkDebug } = require('./debug.controller')

function makeRes () {
  return {
    statusCode: 200,
    body: undefined,
    status (s) { this.statusCode = s; return this },
    json (b) { this.body = b; return this }
  }
}

test('getNetworkDebug returns cached network diagnostics by default', async () => {
  const res = makeRes()
  await getNetworkDebug({ query: {} }, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.status, 'unknown')
  assert.equal(res.body.summary.musicbrainz.policy, 'ipv6_only')
  assert.equal(res.body.summary.musicbrainz.family, 6)
  assert.equal(res.body.summary.musicbrainz.fallbackAllowed, false)
  assert.equal(res.body.summary.itunes.policy, 'auto')
  assert.equal(res.body.summary.itunes.fallbackAllowed, true)
})

test('getNetworkDebug supports explicit refresh', async () => {
  const res = makeRes()
  await getNetworkDebug({ query: { refresh: '1' } }, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.status, 'ok')
  assert.equal(res.body.providers.musicbrainz.state, 'MUSICBRAINZ_IPV6_HEALTHY')
  assert.equal(res.body.providers.itunes.state, 'HEALTHY')
})

const test = require('node:test')
const assert = require('node:assert/strict')

const providers = {
  musicbrainz: require('../providers/musicbrainz.provider'),
  itunes: require('../providers/itunes.provider'),
  theaudiodb: require('../providers/theaudiodb.provider'),
  lastfm: require('../providers/lastfm.provider'),
  discogs: require('../providers/discogs.provider')
}

const { aggregateArtist } = require('../providers')

const REAL_PROVIDER_ENABLED = /^true$/i.test(process.env.REAL_PROVIDER_INTEGRATION || '')
const SKIP_REAL_PROVIDER = REAL_PROVIDER_ENABLED
  ? false
  : 'Set REAL_PROVIDER_INTEGRATION=true to run live provider integration tests.'

const DEFAULT_PROVIDERS = 'musicbrainz,itunes'
const SELECTED_PROVIDERS = String(process.env.REAL_PROVIDER_PROVIDERS || DEFAULT_PROVIDERS)
  .split(',')
  .map(provider => provider.trim().toLowerCase())
  .filter(Boolean)

const ARTIST_QUERY = process.env.REAL_PROVIDER_ARTIST || 'Radiohead'
const MIN_ALBUMS = Number(process.env.REAL_PROVIDER_MIN_ALBUMS || 1)

const REQUIRED_ENV = {
  theaudiodb: 'THEAUDIODB_API_KEY',
  lastfm: 'LASTFM_API_KEY',
  discogs: 'DISCOGS_TOKEN'
}

function skipReasonForProvider (providerName) {
  if (SKIP_REAL_PROVIDER) return SKIP_REAL_PROVIDER
  if (!SELECTED_PROVIDERS.includes(providerName)) return `Provider ${providerName} is not listed in REAL_PROVIDER_PROVIDERS.`

  const requiredEnv = REQUIRED_ENV[providerName]
  if (requiredEnv && !process.env[requiredEnv]) {
    return `Set ${requiredEnv} to run ${providerName} live integration tests.`
  }

  return false
}

function assertProviderResult (providerName, result) {
  assert.equal(typeof result, 'object')
  assert.equal(typeof result.artistName, 'string')
  assert.ok(result.artistName.trim().length > 0, `${providerName} returned a blank artistName`)
  assert.ok(Array.isArray(result.albums), `${providerName} did not return an albums array`)
  assert.ok(result.albums.length >= MIN_ALBUMS, `${providerName} returned fewer than ${MIN_ALBUMS} albums`)

  for (const album of result.albums.slice(0, 5)) {
    assert.equal(typeof album.name, 'string')
    assert.ok(album.name.trim().length > 0, `${providerName} returned an album with a blank name`)
    assert.ok(album.ids && typeof album.ids === 'object', `${providerName} returned an album without ids`)

    if (album.year !== null && album.year !== undefined) {
      assert.equal(typeof album.year, 'number')
      assert.ok(album.year >= 1900 && album.year <= new Date().getFullYear() + 1)
    }
  }
}

test('real provider integration configuration selects at least one provider', { skip: SKIP_REAL_PROVIDER }, () => {
  assert.ok(SELECTED_PROVIDERS.length > 0)

  for (const providerName of SELECTED_PROVIDERS) {
    assert.ok(providers[providerName], `Unknown real provider selected: ${providerName}`)
  }
})

for (const [providerName, provider] of Object.entries(providers)) {
  test(`real provider integration: ${providerName} returns normalized artist albums`, { skip: skipReasonForProvider(providerName), timeout: 30000 }, async () => {
    const result = await provider.searchArtist(ARTIST_QUERY)
    assertProviderResult(providerName, result)
  })
}

test('real provider integration: aggregateArtist returns a stable merged payload', {
  skip: SKIP_REAL_PROVIDER || (!/^true$/i.test(process.env.REAL_PROVIDER_AGGREGATE || '') && 'Set REAL_PROVIDER_AGGREGATE=true to run live aggregation validation.'),
  timeout: 45000
}, async () => {
  if (process.env.REAL_PROVIDER_PROVIDERS) {
    process.env.METADATA_PROVIDERS = SELECTED_PROVIDERS.join(',')
  }

  const result = await aggregateArtist(ARTIST_QUERY)

  assert.equal(typeof result.artistName, 'string')
  assert.ok(result.artistName.trim().length > 0)
  assert.ok(Array.isArray(result.albums))
  assert.ok(result.albums.length >= MIN_ALBUMS)
  assert.ok(Array.isArray(result.providers))
  assert.ok(result.providers.length > 0)
  assert.equal(typeof result.partial, 'boolean')

  for (const album of result.albums.slice(0, 5)) {
    assert.equal(typeof album.name, 'string')
    assert.ok(album.name.trim().length > 0)
    assert.ok(album.ids && typeof album.ids === 'object')
    assert.equal(typeof album.provider, 'string')
    assert.ok(album.provider.trim().length > 0)
  }
})

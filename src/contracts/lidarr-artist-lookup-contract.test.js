const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { withArtistLookupDefaults, LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS } = require('../utils/lidarrArtist')

const lidarrFixturesDir = path.join(__dirname, '../fixtures/lidarr')
const providerFixturesDir = path.join(__dirname, '../fixtures/providers')

function readFixture (name) {
  return JSON.parse(fs.readFileSync(path.join(lidarrFixturesDir, name), 'utf8'))
}

function readProviderFixture (name) {
  return JSON.parse(fs.readFileSync(path.join(providerFixturesDir, name), 'utf8'))
}

function assertHasRequiredArtistFields (artist, label = 'artist') {
  for (const key of LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(artist, key), `${label} missing required key: ${key}`)
  }
}

function assertNoUnsupportedTopLevelFields (artist, label = 'artist') {
  const expectedKeys = [...LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS, ...PROXY_EXTENSION_KEYS]

  for (const key of Object.keys(artist)) {
    assert.ok(expectedKeys.includes(key), `${label} contains unsupported key: ${key}`)
  }
}

// Lidarr-lite-proxy internal fields that are allowed in the response to support Melodash UI and debugging.
// These are not part of the strict Lidarr contract but are preserved for the proxy's dual-purpose design.
const PROXY_EXTENSION_KEYS = [
  'providers',
  'partial',
  'warning',
  'schemaVersion',
  'debug',
  '_generatedAt'
]

const VIVA_LAS_VENGEANCE_RELEASE_GROUP_ID = 'b8fee959-1da5-450b-8708-8f218f6414d4'
const VIVA_LAS_VENGEANCE_RELEASE_DATE = '2022-08-19T00:00:00Z'
const VIVA_LAS_VENGEANCE_COVER = `https://coverartarchive.org/release-group/${VIVA_LAS_VENGEANCE_RELEASE_GROUP_ID}/front-250`

test('Lidarr artist lookup resource matches contract exactly', () => {
  const fixture = readFixture('artist-lookup.golden.json')
  const out = fixture.map(a => withArtistLookupDefaults(a))

  for (const artist of out) {
    assertHasRequiredArtistFields(artist)
    assertNoUnsupportedTopLevelFields(artist)
  }
})

test('withArtistLookupDefaults strictly strips unknown fields from upstream providers', () => {
  const dirty = {
    artistName: 'Radiohead',
    id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    _upstreamSource: 'musicbrainz', // Should be stripped
    matchType: 'exact', // Should be stripped
    garbage: true // Should be stripped
  }

  const cleaned = withArtistLookupDefaults(dirty)

  assert.equal(cleaned.artistName, 'Radiohead')
  assert.equal(cleaned._upstreamSource, undefined)
  assert.equal(cleaned.matchType, undefined)
  assert.equal(cleaned.garbage, undefined)
})

test('provider lookup fixtures normalize into required Lidarr lookup artist fields', () => {
  const fixtures = [
    readProviderFixture('musicbrainz-artist-lookup-success.json').result,
    readProviderFixture('itunes-artist-lookup-success.json').result,
    readProviderFixture('artist-lookup-partial-failure.json').results[0]
  ]

  for (const fixture of fixtures) {
    const artist = withArtistLookupDefaults(fixture)

    assertHasRequiredArtistFields(artist, fixture.artistName)
    assert.equal(typeof artist.artistName, 'string')
    assert.equal(typeof artist.id, 'string')
    assert.equal(typeof artist.foreignArtistId, 'string')
    assert.equal(typeof artist.disambiguation, 'string')
    assert.equal(typeof artist.overview, 'string')
    assert.equal(typeof artist.status, 'string')
    assert.ok(Array.isArray(artist.oldIds))
    assert.ok(Array.isArray(artist.aliases))
    assert.ok(Array.isArray(artist.artistAliases))
    assert.ok(Array.isArray(artist.links))
    assert.ok(Array.isArray(artist.images))
    assert.ok(Array.isArray(artist.albums))
    assert.equal(typeof artist.ratings.votes, 'number')
    assert.equal(typeof artist.ratings.value, 'number')
    assert.equal(typeof artist.rating.count, 'number')
    assert.equal(typeof artist.rating.value, 'number')
  }
})

test('fixture-normalized artist includes every required field', () => {
  const fixture = readProviderFixture('musicbrainz-artist-lookup-success.json').result
  const artist = withArtistLookupDefaults(fixture)

  assert.deepEqual(
    LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS.filter(key => !Object.prototype.hasOwnProperty.call(artist, key)),
    [],
    'fixture-normalized artist must include every required lookup key'
  )
})

test('withArtistLookupDefaults rejects unsupported fields but preserves proxy extension fields', () => {
  const fixture = readProviderFixture('musicbrainz-artist-lookup-success.json').result
  const artist = withArtistLookupDefaults({
    ...fixture,
    confidence: 100,
    providerCount: 1,
    providerErrors: [],
    provider: 'musicbrainz',
    unsupportedObject: { keep: false },
    schemaVersion: 'skyhook-v1',
    partial: true,
    warning: 'degraded result',
    debug: { providers: ['musicbrainz'] },
    _generatedAt: '2026-05-10T00:00:00.000Z'
  })

  assertNoUnsupportedTopLevelFields(artist)
  assert.equal(artist.confidence, undefined)
  assert.equal(artist.providerCount, undefined)
  assert.equal(artist.providerErrors, undefined)
  assert.equal(artist.provider, undefined)
  assert.equal(artist.unsupportedObject, undefined)
  assert.equal(artist.schemaVersion, 'skyhook-v1')
  assert.equal(artist.partial, true)
  assert.equal(artist.warning, 'degraded result')
  assert.deepEqual(artist.debug, { providers: ['musicbrainz'] })
  assert.equal(artist._generatedAt, '2026-05-10T00:00:00.000Z')
})

test('artist and album image url and remoteUrl pairs are normalized from provider fixtures', () => {
  const musicbrainz = withArtistLookupDefaults(readProviderFixture('musicbrainz-artist-lookup-success.json').result)
  const itunes = withArtistLookupDefaults(readProviderFixture('itunes-artist-lookup-success.json').result)

  assert.equal(musicbrainz.images[1].url, 'https://fixtures.melodarr.local/musicbrainz/radiohead/fanart.jpg')
  assert.equal(musicbrainz.images[1].remoteUrl, 'https://fixtures.melodarr.local/musicbrainz/radiohead/fanart.jpg')
  assert.equal(itunes.images[0].url, 'https://fixtures.melodarr.local/itunes/radiohead/artist-poster.jpg')
  assert.equal(itunes.images[0].remoteUrl, 'https://fixtures.melodarr.local/itunes/radiohead/artist-poster.jpg')

  assert.equal(
    musicbrainz.albums[0].images[0].url,
    'https://fixtures.melodarr.local/musicbrainz/release-group/b1392450-e666-3926-a536-22c65f834433/front-250.jpg'
  )
  assert.equal(
    musicbrainz.albums[0].images[0].remoteUrl,
    'https://fixtures.melodarr.local/musicbrainz/release-group/b1392450-e666-3926-a536-22c65f834433/front-250.jpg'
  )
  assert.equal(
    musicbrainz.albums[1].images[0].url,
    'https://fixtures.melodarr.local/musicbrainz/release-group/35d783e4-956c-3d4b-80f5-758b3a2a9d55/front-250.jpg'
  )
  assert.equal(
    musicbrainz.albums[1].images[0].remoteUrl,
    'https://fixtures.melodarr.local/musicbrainz/release-group/35d783e4-956c-3d4b-80f5-758b3a2a9d55/front-250.jpg'
  )
})

test('album remoteCover is set from the first normalized album image url', () => {
  const artist = withArtistLookupDefaults(readProviderFixture('musicbrainz-artist-lookup-success.json').result)

  for (const album of artist.albums) {
    assert.ok(album.images.length > 0, `${album.title} fixture must include images`)
    assert.equal(album.remoteCover, album.images[0].url)
  }
})

test('provider metadata keeps name plus numeric score and albumCount only', () => {
  const artist = withArtistLookupDefaults({
    ...readProviderFixture('musicbrainz-artist-lookup-success.json').result,
    providers: [
      {
        name: 'musicbrainz',
        status: 'success',
        score: '100',
        albumCount: '2',
        metadata: { endpoint: 'artist-lookup' },
        error: { message: 'ignored' }
      }
    ]
  })

  assert.deepEqual(artist.providers, [
    {
      name: 'musicbrainz',
      score: 100,
      albumCount: 2
    }
  ])
  assert.equal(typeof artist.providers[0].score, 'number')
  assert.equal(typeof artist.providers[0].albumCount, 'number')
})

test('empty provider lookup fixture returns an empty array', () => {
  const fixture = readProviderFixture('artist-lookup-empty.json')
  const results = fixture.results.map(result => withArtistLookupDefaults(result))

  assert.deepEqual(results, [])
  assert.equal(fixture.partial, false)
})

test('partial provider failure fixture produces a valid degraded lookup response', () => {
  const fixture = readProviderFixture('artist-lookup-partial-failure.json')
  const results = fixture.results.map(result => withArtistLookupDefaults(result))

  assert.equal(fixture.partial, true)
  assert.equal(results.length, 1)

  const artist = results[0]
  assertHasRequiredArtistFields(artist)
  assertNoUnsupportedTopLevelFields(artist)
  assert.equal(artist.artistName, 'Radiohead')
  assert.equal(artist.partial, true)
  assert.equal(artist.warning, 'Some providers failed: itunes: upstream request failed')
  assert.deepEqual(artist.providers, [
    {
      name: 'musicbrainz',
      score: 100,
      albumCount: 1
    },
    {
      name: 'itunes',
      score: 0,
      albumCount: 0
    }
  ])
  assert.equal(artist.albums.length, 1)
})

test('artist lookup includes complete Viva Las Vengeance album summary from mocked MusicBrainz data', () => {
  const [artist] = [{
    artistName: 'Panic! at the Disco',
    id: 'b9472588-93f3-4922-a1a2-74082cdf9ce8',
    albums: [{
      title: 'Viva Las Vengeance',
      id: VIVA_LAS_VENGEANCE_RELEASE_GROUP_ID,
      firstReleaseDate: VIVA_LAS_VENGEANCE_RELEASE_DATE,
      releaseDate: VIVA_LAS_VENGEANCE_RELEASE_DATE,
      provider: 'musicbrainz',
      ids: {
        musicbrainzReleaseGroupId: VIVA_LAS_VENGEANCE_RELEASE_GROUP_ID
      },
      images: [{
        coverType: 'cover',
        url: VIVA_LAS_VENGEANCE_COVER,
        remoteUrl: VIVA_LAS_VENGEANCE_COVER
      }],
      remoteCover: VIVA_LAS_VENGEANCE_COVER
    }]
  }].map(a => withArtistLookupDefaults(a))

  const album = artist.albums.find(album => album.title === 'Viva Las Vengeance')
  assert.ok(album, 'Panic! at the Disco lookup must include Viva Las Vengeance')
  assert.equal(album.id, VIVA_LAS_VENGEANCE_RELEASE_GROUP_ID)
  assert.equal(album.ids.musicbrainzReleaseGroupId, VIVA_LAS_VENGEANCE_RELEASE_GROUP_ID)
  assert.equal(album.title, 'Viva Las Vengeance')
  assert.equal(album.releaseDate, VIVA_LAS_VENGEANCE_RELEASE_DATE)
  assert.equal(album.provider, 'musicbrainz')
  assert.equal(album.images.length, 1)
  assert.equal(album.images[0].url, VIVA_LAS_VENGEANCE_COVER)
  assert.ok(album.images[0].url.includes('https://coverartarchive.org/release-group/'))
  assert.equal(album.remoteCover, album.images[0].url)
})

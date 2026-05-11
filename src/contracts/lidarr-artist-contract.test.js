const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  SKYHOOK_ARTIST_RESOURCE_KEYS,
  SKYHOOK_ALBUM_REQUIRED_KEYS,
  SKYHOOK_RELEASE_REQUIRED_KEYS,
  SKYHOOK_TRACK_REQUIRED_KEYS,
  SKYHOOK_MEDIUM_REQUIRED_KEYS,
  SKYHOOK_IMAGE_REQUIRED_KEYS,
  SKYHOOK_LINK_REQUIRED_KEYS,
  SKYHOOK_RATING_REQUIRED_KEYS,
  toSkyhookArtistResource
} = require('../utils/lidarrArtist')

const fixturesDir = path.join(__dirname, '../fixtures/lidarr')

const VIVA_LAS_VENGEANCE_RELEASE_GROUP_ID = 'b8fee959-1da5-450b-8708-8f218f6414d4'
const VIVA_LAS_VENGEANCE_RELEASE_DATE = '2022-08-19T00:00:00Z'

function readFixture (name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'))
}

function assertKeysExact (obj, allowedKeys, label) {
  const keys = Object.keys(obj)
  for (const key of keys) {
    assert.ok(allowedKeys.includes(key), `${label} contains unsupported key: "${key}"`)
  }
  for (const key of allowedKeys) {
    assert.ok(key in obj, `${label} missing required key: "${key}"`)
  }
}

function makeTracks (count, artistId = 'b9472588-93f3-4922-a1a2-74082cdf9ce8') {
  return Array.from({ length: count }, (_, index) => {
    const position = index + 1
    return {
      artistId,
      durationMs: 180000 + position,
      id: `viva-track-${position}`,
      oldIds: [],
      recordingId: `viva-recording-${position}`,
      oldRecordingIds: [],
      trackName: `Track ${position}`,
      trackNumber: String(position),
      trackPosition: position,
      explicit: false,
      mediumNumber: 1
    }
  })
}

// ─── Top-level artist shape ──────────────────────────────────────────

test('Artist by ID response matches SkyHook artist resource contract exactly', () => {
  const fixture = readFixture('artist-by-id.golden.json')
  const artist = toSkyhookArtistResource(fixture)

  assertKeysExact(artist, SKYHOOK_ARTIST_RESOURCE_KEYS, 'artist')
})

test('Artist response contains correct primitive types', () => {
  const fixture = readFixture('artist-by-id.golden.json')
  const artist = toSkyhookArtistResource(fixture)

  assert.equal(typeof artist.artistName, 'string')
  assert.equal(typeof artist.disambiguation, 'string')
  assert.equal(typeof artist.overview, 'string')
  assert.equal(typeof artist.id, 'string')
  assert.equal(typeof artist.type, 'string')
  assert.equal(typeof artist.status, 'string')
  assert.equal(typeof artist.artistUrl, 'string')
  assert.ok(Array.isArray(artist.genres), 'genres must be an array')
  assert.ok(Array.isArray(artist.oldIds), 'oldIds must be an array')
  assert.ok(Array.isArray(artist.images), 'images must be an array')
  assert.ok(Array.isArray(artist.links), 'links must be an array')
  assert.ok(Array.isArray(artist.artistAliases), 'artistAliases must be an array')
  assert.ok(Array.isArray(artist.albums), 'albums must be an array')
  assert.ok(typeof artist.rating === 'object' && artist.rating !== null, 'rating must be an object')
})

// ─── Artist rating ───────────────────────────────────────────────────

test('Artist rating matches rating contract exactly', () => {
  const fixture = readFixture('artist-by-id.golden.json')
  const artist = toSkyhookArtistResource(fixture)

  assertKeysExact(artist.rating, SKYHOOK_RATING_REQUIRED_KEYS, 'artist rating')
  assert.equal(typeof artist.rating.count, 'number')
  assert.equal(typeof artist.rating.value, 'number')
})

// ─── Nested images ───────────────────────────────────────────────────

test('Artist image resources match image contract exactly', () => {
  const fixture = readFixture('artist-by-id.golden.json')
  const artist = toSkyhookArtistResource(fixture)

  assert.ok(artist.images.length > 0, 'fixture must contain at least one image')

  for (const image of artist.images) {
    assertKeysExact(image, SKYHOOK_IMAGE_REQUIRED_KEYS, 'artist image')
  }
})

// ─── Nested links ────────────────────────────────────────────────────

test('Artist link resources match link contract exactly', () => {
  const fixture = readFixture('artist-by-id.golden.json')
  const artist = toSkyhookArtistResource(fixture)

  assert.ok(artist.links.length > 0, 'fixture must contain at least one link')

  for (const link of artist.links) {
    assertKeysExact(link, SKYHOOK_LINK_REQUIRED_KEYS, 'artist link')
  }
})

// ─── Nested albums (recursive) ──────────────────────────────────────

test('Nested album resources match SkyHook album contract exactly', () => {
  const fixture = readFixture('artist-by-id.golden.json')
  const artist = toSkyhookArtistResource(fixture)

  assert.ok(artist.albums.length > 0, 'fixture must contain at least one album')

  for (const album of artist.albums) {
    assertKeysExact(album, SKYHOOK_ALBUM_REQUIRED_KEYS, 'nested album')
  }
})

test('Nested album rating resources match rating contract exactly', () => {
  const fixture = readFixture('artist-by-id.golden.json')
  const artist = toSkyhookArtistResource(fixture)

  for (const album of artist.albums) {
    assertKeysExact(album.rating, SKYHOOK_RATING_REQUIRED_KEYS, 'nested album rating')
    assert.equal(typeof album.rating.count, 'number')
    assert.equal(typeof album.rating.value, 'number')
  }
})

test('Nested album releases match release contract exactly', () => {
  const fixture = readFixture('artist-by-id.golden.json')
  const artist = toSkyhookArtistResource(fixture)

  const releases = artist.albums.flatMap(a => a.releases)
  assert.ok(releases.length > 0, 'fixture must contain at least one release')

  for (const release of releases) {
    assertKeysExact(release, SKYHOOK_RELEASE_REQUIRED_KEYS, 'nested album release')
  }
})

test('Nested album tracks match track contract exactly', () => {
  const fixture = readFixture('artist-by-id.golden.json')
  const artist = toSkyhookArtistResource(fixture)

  const tracks = artist.albums.flatMap(a => a.releases).flatMap(r => r.tracks)
  assert.ok(tracks.length > 0, 'fixture must contain at least one track')

  for (const track of tracks) {
    assertKeysExact(track, SKYHOOK_TRACK_REQUIRED_KEYS, 'nested album track')
  }
})

test('Nested album media match medium contract exactly', () => {
  const fixture = readFixture('artist-by-id.golden.json')
  const artist = toSkyhookArtistResource(fixture)

  const media = artist.albums.flatMap(a => a.releases).flatMap(r => r.media)
  assert.ok(media.length > 0, 'fixture must contain at least one medium')

  for (const medium of media) {
    assertKeysExact(medium, SKYHOOK_MEDIUM_REQUIRED_KEYS, 'nested album medium')
  }
})

test('Nested album images match image contract exactly', () => {
  const fixture = readFixture('artist-by-id.golden.json')
  const artist = toSkyhookArtistResource(fixture)

  const images = artist.albums.flatMap(a => a.images)
  assert.ok(images.length > 0, 'fixture must contain at least one album image')

  for (const image of images) {
    assertKeysExact(image, SKYHOOK_IMAGE_REQUIRED_KEYS, 'nested album image')
  }
})

test('Artist by ID nested Viva Las Vengeance releases preserve complete track counts', () => {
  const artist = toSkyhookArtistResource({
    id: 'b9472588-93f3-4922-a1a2-74082cdf9ce8',
    artistName: 'Panic! at the Disco',
    albums: [{
      id: VIVA_LAS_VENGEANCE_RELEASE_GROUP_ID,
      title: 'Viva Las Vengeance',
      releaseDate: VIVA_LAS_VENGEANCE_RELEASE_DATE,
      releases: [{
        id: 'ec5aab3d-8f86-43c2-8b16-455ac84a97b2',
        title: 'Viva Las Vengeance',
        releaseDate: VIVA_LAS_VENGEANCE_RELEASE_DATE,
        status: 'Official',
        trackCount: 12,
        media: [{
          name: 'Digital Media',
          format: 'Digital Media',
          position: 1
        }],
        tracks: makeTracks(12)
      }]
    }]
  })

  const album = artist.albums.find(album => album.title === 'Viva Las Vengeance')
  assert.ok(album, 'artist-by-id response must include Viva Las Vengeance')

  const matchingRelease = album.releases.find(release => release.trackCount === 12)
  assert.ok(matchingRelease, 'Viva Las Vengeance must include at least one 12-track release')

  for (const release of album.releases) {
    if (release.trackCount > 0) {
      assert.equal(release.tracks.length, release.trackCount)
    }
  }
})

// ─── Recursive artist-in-album ──────────────────────────────────────

test('Artists nested within albums match SkyHook artist resource contract exactly', () => {
  const fixture = readFixture('artist-by-id.golden.json')
  const artist = toSkyhookArtistResource(fixture)

  const nestedArtists = artist.albums.flatMap(a => a.artists)
  assert.ok(nestedArtists.length > 0, 'fixture must contain at least one nested artist in albums')

  for (const nestedArtist of nestedArtists) {
    assertKeysExact(nestedArtist, SKYHOOK_ARTIST_RESOURCE_KEYS, 'nested album artist')
  }
})

// ─── Stripping unknown fields ───────────────────────────────────────

test('toSkyhookArtistResource strips unknown fields from upstream data', () => {
  const dirty = {
    id: 'test-artist-id',
    artistName: 'Test Artist',
    type: 'Group',
    _upstreamSource: 'musicbrainz',
    internalScore: 99,
    garbage: true,
    foreignArtistId: 'test-artist-id',
    providers: ['musicbrainz'],
    partial: false,
    schemaVersion: 3
  }

  const cleaned = toSkyhookArtistResource(dirty)

  assert.equal(cleaned._upstreamSource, undefined)
  assert.equal(cleaned.internalScore, undefined)
  assert.equal(cleaned.garbage, undefined)
  assert.equal(cleaned.foreignArtistId, undefined)
  assert.equal(cleaned.providers, undefined)
  assert.equal(cleaned.partial, undefined)
  assert.equal(cleaned.schemaVersion, undefined)
  assert.equal(cleaned.id, 'test-artist-id')
  assert.equal(cleaned.artistName, 'Test Artist')
})

// ─── Defaults for minimal input ─────────────────────────────────────

test('toSkyhookArtistResource applies defaults for missing fields', () => {
  const minimal = {
    id: 'minimal-artist',
    artistName: 'Minimal'
  }

  const artist = toSkyhookArtistResource(minimal)

  assert.equal(artist.id, 'minimal-artist')
  assert.equal(artist.artistName, 'Minimal')
  assert.equal(artist.type, 'Group')
  assert.equal(artist.status, 'active')
  assert.equal(artist.disambiguation, '')
  assert.equal(artist.overview, '')
  assert.equal(artist.artistUrl, '')
  assert.deepEqual(artist.albums, [])
  assert.deepEqual(artist.images, [])
  assert.deepEqual(artist.links, [])
  assert.deepEqual(artist.genres, [])
  assert.deepEqual(artist.oldIds, [])
  assert.deepEqual(artist.artistAliases, [])
  assertKeysExact(artist, SKYHOOK_ARTIST_RESOURCE_KEYS, 'minimal artist')
  assertKeysExact(artist.rating, SKYHOOK_RATING_REQUIRED_KEYS, 'minimal artist rating')
})

// ─── Fixture golden snapshot ─────────────────────────────────────────

test('Golden fixture serializes to expected field values', () => {
  const fixture = readFixture('artist-by-id.golden.json')
  const artist = toSkyhookArtistResource(fixture)

  assert.equal(artist.artistName, 'Radiohead')
  assert.equal(artist.id, 'a74b1b7f-71a5-4011-9441-d0b5e4122711')
  assert.equal(artist.type, 'Group')
  assert.equal(artist.status, 'active')
  assert.equal(artist.disambiguation, 'English rock band')
  assert.equal(artist.artistUrl, 'https://www.radiohead.com')
  assert.equal(artist.albums.length, 2)
  assert.equal(artist.images.length, 2)
  assert.equal(artist.links.length, 2)
  assert.deepEqual(artist.genres, ['alternative rock', 'electronic', 'art rock'])
  assert.equal(artist.rating.count, 128)
  assert.equal(artist.rating.value, 4.7)

  // Verify album ordering and titles
  assert.equal(artist.albums[0].title, 'OK Computer')
  assert.equal(artist.albums[1].title, 'Kid A')
})

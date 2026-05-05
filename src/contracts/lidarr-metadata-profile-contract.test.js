const test = require('node:test')
const assert = require('node:assert/strict')

const { toSkyhookAlbumResource } = require('../utils/lidarrArtist')

const PRIMARY_ALBUM_TYPES = Object.freeze(['Album', 'EP', 'Single', 'Broadcast', 'Other'])
const SECONDARY_ALBUM_TYPES = Object.freeze([
  'Studio',
  'Compilation',
  'Soundtrack',
  'Spokenword',
  'Interview',
  'Audiobook',
  'Live',
  'Remix',
  'DJ-mix',
  'Mixtape/Street',
  'Demo',
  'Audio drama'
])
const RELEASE_STATUSES = Object.freeze(['Official', 'Promotion', 'Bootleg', 'Pseudo-Release'])

const STANDARD_METADATA_PROFILE = Object.freeze({
  primaryAlbumTypes: Object.freeze(['Album']),
  secondaryAlbumTypes: Object.freeze(['Studio']),
  releaseStatuses: Object.freeze(['Official'])
})

const NONE_METADATA_PROFILE = Object.freeze({
  primaryAlbumTypes: Object.freeze([]),
  secondaryAlbumTypes: Object.freeze([]),
  releaseStatuses: Object.freeze([])
})

function matchesLidarrFilterAlbums (album, profile) {
  // Source of truth:
  // Lidarr SkyHookProxy.FilterAlbums requires:
  // - album.Type in allowed PrimaryAlbumTypes
  // - no SecondaryTypes plus allowed Studio, or any allowed SecondaryType
  // - any ReleaseStatuses entry in allowed ReleaseStatuses
  return profile.primaryAlbumTypes.includes(album.type) &&
    ((!album.secondaryTypes.length && profile.secondaryAlbumTypes.includes('Studio')) ||
      album.secondaryTypes.some(type => profile.secondaryAlbumTypes.includes(type))) &&
    album.releaseStatuses.some(status => profile.releaseStatuses.includes(status))
}

function albumResource (overrides = {}) {
  return toSkyhookAlbumResource({
    artistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    id: 'b1392450-e666-3926-a536-22c65f834433',
    title: 'OK Computer',
    ...overrides
  })
}

test('Lidarr metadata profile enum values stay source-compatible', () => {
  // Source of truth:
  // PrimaryAlbumType.All, SecondaryAlbumType.All, and ReleaseStatus.All in Lidarr.
  assert.deepEqual(PRIMARY_ALBUM_TYPES, ['Album', 'EP', 'Single', 'Broadcast', 'Other'])
  assert.deepEqual(SECONDARY_ALBUM_TYPES, [
    'Studio',
    'Compilation',
    'Soundtrack',
    'Spokenword',
    'Interview',
    'Audiobook',
    'Live',
    'Remix',
    'DJ-mix',
    'Mixtape/Street',
    'Demo',
    'Audio drama'
  ])
  assert.deepEqual(RELEASE_STATUSES, ['Official', 'Promotion', 'Bootleg', 'Pseudo-Release'])
})

test('Lidarr standard metadata profile accepts only Album + Studio + Official by default', () => {
  // Source of truth:
  // MetadataProfileService.AddDefaultProfile("Standard") allows Album, Studio, Official.
  assert.equal(matchesLidarrFilterAlbums(albumResource({
    type: 'Album',
    secondaryTypes: [],
    releaseStatuses: ['Official']
  }), STANDARD_METADATA_PROFILE), true)

  assert.equal(matchesLidarrFilterAlbums(albumResource({
    type: 'Album',
    secondaryTypes: ['Studio'],
    releaseStatuses: ['Official']
  }), STANDARD_METADATA_PROFILE), true)

  assert.equal(matchesLidarrFilterAlbums(albumResource({
    type: 'Single',
    secondaryTypes: [],
    releaseStatuses: ['Official']
  }), STANDARD_METADATA_PROFILE), false)

  assert.equal(matchesLidarrFilterAlbums(albumResource({
    type: 'Album',
    secondaryTypes: ['Live'],
    releaseStatuses: ['Official']
  }), STANDARD_METADATA_PROFILE), false)

  assert.equal(matchesLidarrFilterAlbums(albumResource({
    type: 'Album',
    secondaryTypes: [],
    releaseStatuses: ['Bootleg']
  }), STANDARD_METADATA_PROFILE), false)
})

test('Lidarr none metadata profile rejects every album shape', () => {
  // Source of truth:
  // MetadataProfileService.AddDefaultProfile("None") allows no primary,
  // secondary, or release status values.
  const candidates = [
    albumResource({ type: 'Album', secondaryTypes: [], releaseStatuses: ['Official'] }),
    albumResource({ type: 'Album', secondaryTypes: ['Studio'], releaseStatuses: ['Official'] }),
    albumResource({ type: 'EP', secondaryTypes: [], releaseStatuses: ['Official'] })
  ]

  for (const candidate of candidates) {
    assert.equal(matchesLidarrFilterAlbums(candidate, NONE_METADATA_PROFILE), false)
  }
})

test('SkyHook AlbumResource defaults missing status/type fields to standard-profile-safe values', () => {
  const album = albumResource()

  assert.equal(album.type, 'Album')
  assert.deepEqual(album.secondaryTypes, [])
  assert.deepEqual(album.releaseStatuses, ['Official'])
  assert.equal(matchesLidarrFilterAlbums(album, STANDARD_METADATA_PROFILE), true)
})

test('SkyHook AlbumResource preserves profile fields as arrays for Lidarr FilterAlbums', () => {
  const album = albumResource({
    type: 'Album',
    secondaryTypes: ['Compilation', 'Live'],
    releaseStatuses: ['Official', 'Promotion']
  })

  assert.ok(Array.isArray(album.secondaryTypes))
  assert.ok(Array.isArray(album.releaseStatuses))
  assert.deepEqual(album.secondaryTypes, ['Compilation', 'Live'])
  assert.deepEqual(album.releaseStatuses, ['Official', 'Promotion'])

  assert.equal(matchesLidarrFilterAlbums(album, {
    primaryAlbumTypes: ['Album'],
    secondaryAlbumTypes: ['Live'],
    releaseStatuses: ['Promotion']
  }), true)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const fixturesDir = path.join(__dirname, '../fixtures/lidarr')

const RELEASE_BASE_KEYS = Object.freeze([
  'age',
  'ageHours',
  'ageMinutes',
  'airDate',
  'albumTitle',
  'approved',
  'artistName',
  'commentUrl',
  'customFormatScore',
  'customFormats',
  'discography',
  'downloadAllowed',
  'downloadUrl',
  'guid',
  'id',
  'indexer',
  'indexerFlags',
  'indexerId',
  'infoHash',
  'infoUrl',
  'leechers',
  'magnetUrl',
  'protocol',
  'publishDate',
  'quality',
  'qualityWeight',
  'rejected',
  'rejections',
  'releaseGroup',
  'releaseHash',
  'releaseWeight',
  'sceneSource',
  'seeders',
  'size',
  'subGroup',
  'temporarilyRejected',
  'title'
])

const RELEASE_OPTIONAL_QUEUE_KEYS = Object.freeze([
  'albumId',
  'artistId',
  'downloadClient',
  'downloadClientId'
])

const QUALITY_MODEL_KEYS = Object.freeze(['quality', 'revision'])
const QUALITY_KEYS = Object.freeze(['id', 'name'])
const REVISION_KEYS = Object.freeze(['isRepack', 'real', 'version'])
const CUSTOM_FORMAT_BASE_KEYS = Object.freeze(['id', 'name'])
const CUSTOM_FORMAT_DETAIL_KEYS = Object.freeze(['id', 'includeCustomFormatWhenRenaming', 'name', 'specifications'])

function readFixture (name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'))
}

function assertExactKeys (value, keys, label) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys drifted from Lidarr source`)
}

function assertNullableString (value, label) {
  assert.ok(value === null || typeof value === 'string', `${label} must be string or null`)
}

function assertNullableInteger (value, label) {
  assert.ok(value === null || Number.isInteger(value), `${label} must be integer or null`)
}

function assertQualityModelContract (quality) {
  assertExactKeys(quality, QUALITY_MODEL_KEYS, 'QualityModel')
  assertExactKeys(quality.quality, QUALITY_KEYS, 'Quality')
  assertExactKeys(quality.revision, REVISION_KEYS, 'Revision')

  assert.equal(typeof quality.quality.id, 'number')
  assert.equal(Number.isInteger(quality.quality.id), true)
  assertNullableString(quality.quality.name, 'quality.name')
  assert.equal(typeof quality.revision.version, 'number')
  assert.equal(Number.isInteger(quality.revision.version), true)
  assert.equal(typeof quality.revision.real, 'number')
  assert.equal(Number.isInteger(quality.revision.real), true)
  assert.equal(typeof quality.revision.isRepack, 'boolean')
}

function assertCustomFormatContract (format) {
  const keys = Object.keys(format).sort()
  const base = [...CUSTOM_FORMAT_BASE_KEYS].sort()
  const detailed = [...CUSTOM_FORMAT_DETAIL_KEYS].sort()
  assert.ok(
    JSON.stringify(keys) === JSON.stringify(base) || JSON.stringify(keys) === JSON.stringify(detailed),
    'CustomFormatResource keys drifted from Lidarr source'
  )

  assert.equal(typeof format.id, 'number')
  assert.equal(Number.isInteger(format.id), true)
  assertNullableString(format.name, 'customFormats[].name')
  if (Object.prototype.hasOwnProperty.call(format, 'includeCustomFormatWhenRenaming')) {
    assert.ok(format.includeCustomFormatWhenRenaming === null || typeof format.includeCustomFormatWhenRenaming === 'boolean')
  }
  if (Object.prototype.hasOwnProperty.call(format, 'specifications')) {
    assert.ok(format.specifications === null || Array.isArray(format.specifications))
  }
}

function assertReleaseContract (release) {
  const allowed = new Set([...RELEASE_BASE_KEYS, ...RELEASE_OPTIONAL_QUEUE_KEYS])
  for (const key of Object.keys(release)) {
    assert.equal(allowed.has(key), true, `ReleaseResource contains unsupported key: ${key}`)
  }
  for (const key of RELEASE_BASE_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(release, key), true, `ReleaseResource missing key: ${key}`)
  }

  assert.equal(typeof release.id, 'number')
  assert.equal(Number.isInteger(release.id), true)
  assertNullableString(release.guid, 'guid')
  assertQualityModelContract(release.quality)
  assert.equal(typeof release.qualityWeight, 'number')
  assert.equal(Number.isInteger(release.qualityWeight), true)
  assert.equal(typeof release.age, 'number')
  assert.equal(Number.isInteger(release.age), true)
  assert.equal(typeof release.ageHours, 'number')
  assert.equal(typeof release.ageMinutes, 'number')
  assert.equal(typeof release.size, 'number')
  assert.equal(Number.isInteger(release.size), true)
  assert.equal(typeof release.indexerId, 'number')
  assert.equal(Number.isInteger(release.indexerId), true)
  assertNullableString(release.indexer, 'indexer')
  assertNullableString(release.releaseGroup, 'releaseGroup')
  assertNullableString(release.subGroup, 'subGroup')
  assertNullableString(release.releaseHash, 'releaseHash')
  assertNullableString(release.title, 'title')
  assert.equal(typeof release.discography, 'boolean')
  assert.equal(typeof release.sceneSource, 'boolean')
  assertNullableString(release.airDate, 'airDate')
  assertNullableString(release.artistName, 'artistName')
  assertNullableString(release.albumTitle, 'albumTitle')
  assert.equal(typeof release.approved, 'boolean')
  assert.equal(typeof release.temporarilyRejected, 'boolean')
  assert.equal(typeof release.rejected, 'boolean')
  assert.ok(Array.isArray(release.rejections), 'rejections must be [] or string[]; Lidarr maps Rejection.Reason only')
  for (const rejection of release.rejections) {
    assert.equal(typeof rejection, 'string', 'rejections[] item must be a string reason, not an object')
  }
  assert.equal(typeof release.publishDate, 'string')
  assert.match(release.publishDate, /^\d{4}-\d{2}-\d{2}T/)
  assertNullableString(release.commentUrl, 'commentUrl')
  assertNullableString(release.downloadUrl, 'downloadUrl')
  assertNullableString(release.infoUrl, 'infoUrl')
  assert.equal(typeof release.downloadAllowed, 'boolean')
  assert.equal(typeof release.releaseWeight, 'number')
  assert.equal(Number.isInteger(release.releaseWeight), true)
  assert.ok(Array.isArray(release.customFormats), 'customFormats must be [] or CustomFormatResource[]')
  for (const format of release.customFormats) {
    assertCustomFormatContract(format)
  }
  assert.equal(typeof release.customFormatScore, 'number')
  assert.equal(Number.isInteger(release.customFormatScore), true)
  assertNullableString(release.magnetUrl, 'magnetUrl')
  assertNullableString(release.infoHash, 'infoHash')
  assertNullableInteger(release.seeders, 'seeders')
  assertNullableInteger(release.leechers, 'leechers')
  assert.ok(['unknown', 'usenet', 'torrent'].includes(release.protocol), 'protocol must serialize as DownloadProtocol enum string')
  assert.equal(typeof release.indexerFlags, 'number')
  assert.equal(Number.isInteger(release.indexerFlags), true)

  if (Object.prototype.hasOwnProperty.call(release, 'artistId')) {
    assert.equal(Number.isInteger(release.artistId), true, 'artistId is omitted when unset; if present it must be an integer')
  }
  if (Object.prototype.hasOwnProperty.call(release, 'albumId')) {
    assert.equal(Number.isInteger(release.albumId), true, 'albumId is omitted when unset; if present it must be an integer')
  }
  if (Object.prototype.hasOwnProperty.call(release, 'downloadClientId')) {
    assert.equal(Number.isInteger(release.downloadClientId), true, 'downloadClientId is omitted when unset; if present it must be an integer')
  }
  if (Object.prototype.hasOwnProperty.call(release, 'downloadClient')) {
    assert.equal(typeof release.downloadClient, 'string', 'downloadClient is omitted when unset; if present it must be a string')
  }
}

test('Lidarr release contract accepts empty result []', () => {
  assert.deepEqual(readFixture('release-empty.golden.json'), [])
})

test('Lidarr approved ReleaseResource fixture matches source contract', () => {
  const fixture = readFixture('release-approved.golden.json')
  assert.equal(fixture.length, 1)
  const release = fixture[0]

  assertReleaseContract(release)
  assert.equal(release.approved, true)
  assert.equal(release.temporarilyRejected, false)
  assert.equal(release.rejected, false)
  assert.deepEqual(release.rejections, [])
  assert.equal(Object.prototype.hasOwnProperty.call(release, 'artistId'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(release, 'albumId'), false)
})

test('Lidarr rejected ReleaseResource fixture uses string rejections from source mapper', () => {
  const fixture = readFixture('release-rejected.golden.json')
  assert.equal(fixture.length, 1)
  const release = fixture[0]

  assertReleaseContract(release)
  assert.equal(release.approved, false)
  assert.equal(release.temporarilyRejected, false)
  assert.equal(release.rejected, true)
  assert.deepEqual(release.rejections, ['Existing file meets cutoff', 'Release is not wanted'])
})

test('Lidarr mixed ReleaseResource fixture covers temporary rejection and queue-id fields', () => {
  const fixture = readFixture('release-mixed.golden.json')
  assert.equal(fixture.length, 2)
  for (const release of fixture) {
    assertReleaseContract(release)
  }

  assert.equal(fixture[0].approved, true)
  assert.equal(Object.prototype.hasOwnProperty.call(fixture[0], 'artistId'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(fixture[0], 'albumId'), false)

  assert.equal(fixture[1].approved, false)
  assert.equal(fixture[1].temporarilyRejected, true)
  assert.equal(fixture[1].rejected, false)
  assert.deepEqual(fixture[1].rejections, ['Indexer unavailable, retry later'])
  assert.equal(fixture[1].artistId, 700)
  assert.equal(fixture[1].albumId, 6271)
  assert.equal(fixture[1].downloadClientId, 2)
  assert.equal(fixture[1].downloadClient, 'Transmission')
})

test('Lidarr ReleaseResource rejects common non-source approximations', () => {
  const bad = {
    ...readFixture('release-approved.golden.json')[0],
    rejections: [{ reason: 'wrong shape' }],
    artistId: null,
    albumId: null
  }

  assert.throws(() => assertReleaseContract(bad), /rejections\[\] item must be a string reason/)
})

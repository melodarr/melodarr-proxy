const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const fixturesDir = path.join(__dirname, '../fixtures/lidarr')

const QUEUE_RESOURCE_KEYS = Object.freeze([
  'added',
  'album',
  'albumId',
  'artist',
  'artistId',
  'customFormatScore',
  'customFormats',
  'downloadClient',
  'downloadClientHasPostImportCategory',
  'downloadForced',
  'downloadId',
  'errorMessage',
  'estimatedCompletionTime',
  'id',
  'indexer',
  'outputPath',
  'protocol',
  'quality',
  'size',
  'sizeleft',
  'status',
  'statusMessages',
  'timeleft',
  'title',
  'trackFileCount',
  'trackHasFileCount',
  'trackedDownloadState',
  'trackedDownloadStatus'
])

const ALBUM_RESOURCE_KEYS = Object.freeze([
  'addOptions',
  'albumType',
  'anyReleaseOk',
  'artist',
  'artistId',
  'disambiguation',
  'duration',
  'foreignAlbumId',
  'genres',
  'id',
  'images',
  'lastSearchTime',
  'links',
  'media',
  'mediumCount',
  'monitored',
  'overview',
  'profileId',
  'ratings',
  'releaseDate',
  'releases',
  'remoteCover',
  'secondaryTypes',
  'statistics',
  'title'
])

const QUALITY_MODEL_KEYS = Object.freeze(['quality', 'revision'])
const QUALITY_KEYS = Object.freeze(['id', 'name'])
const REVISION_KEYS = Object.freeze(['isRepack', 'real', 'version'])
const CUSTOM_FORMAT_BASE_KEYS = Object.freeze(['id', 'name'])
const CUSTOM_FORMAT_DETAIL_KEYS = Object.freeze(['id', 'includeCustomFormatWhenRenaming', 'name', 'specifications'])
const STATUS_MESSAGE_KEYS = Object.freeze(['messages', 'title'])
const RATINGS_KEYS = Object.freeze(['value', 'votes'])
const ALBUM_STATISTICS_KEYS = Object.freeze(['percentOfTracks', 'sizeOnDisk', 'totalTrackCount', 'trackCount', 'trackFileCount'])
const DOWNLOAD_PROTOCOLS = Object.freeze(['unknown', 'usenet', 'torrent'])
const TRACKED_DOWNLOAD_STATUSES = Object.freeze(['ok', 'warning', 'error'])
const TRACKED_DOWNLOAD_STATES = Object.freeze([
  'downloading',
  'downloadFailed',
  'downloadFailedPending',
  'importBlocked',
  'importPending',
  'importing',
  'importFailed',
  'imported',
  'ignored'
])

function readFixture (name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'))
}

function assertExactKeys (value, keys, label) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys drifted from Lidarr source`)
}

function assertInteger (value, label) {
  assert.equal(Number.isInteger(value), true, `${label} must be an integer`)
}

function assertNullableInteger (value, label) {
  assert.ok(value === null || Number.isInteger(value), `${label} must be integer or null`)
}

function assertNullableString (value, label) {
  assert.ok(value === null || typeof value === 'string', `${label} must be string or null`)
}

function assertNullableDateTime (value, label) {
  assert.ok(value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)), `${label} must be ISO datetime string or null`)
}

function assertRatingsContract (ratings, label) {
  assertExactKeys(ratings, RATINGS_KEYS, label)
  assert.equal(typeof ratings.votes, 'number')
  assert.equal(typeof ratings.value, 'number')
}

function assertQualityModelContract (quality) {
  assertExactKeys(quality, QUALITY_MODEL_KEYS, 'QualityModel')
  assertExactKeys(quality.quality, QUALITY_KEYS, 'Quality')
  assertExactKeys(quality.revision, REVISION_KEYS, 'Revision')

  assertInteger(quality.quality.id, 'quality.quality.id')
  assertNullableString(quality.quality.name, 'quality.quality.name')
  assertInteger(quality.revision.version, 'quality.revision.version')
  assertInteger(quality.revision.real, 'quality.revision.real')
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

  assertInteger(format.id, 'customFormats[].id')
  assertNullableString(format.name, 'customFormats[].name')
  if (Object.prototype.hasOwnProperty.call(format, 'includeCustomFormatWhenRenaming')) {
    assert.ok(format.includeCustomFormatWhenRenaming === null || typeof format.includeCustomFormatWhenRenaming === 'boolean')
  }
  if (Object.prototype.hasOwnProperty.call(format, 'specifications')) {
    assert.ok(format.specifications === null || Array.isArray(format.specifications))
  }
}

function assertStatusMessageContract (message) {
  assertExactKeys(message, STATUS_MESSAGE_KEYS, 'TrackedDownloadStatusMessage')
  assertNullableString(message.title, 'statusMessages[].title')
  assert.ok(message.messages === null || Array.isArray(message.messages), 'statusMessages[].messages must be string[] or null')
  if (Array.isArray(message.messages)) {
    for (const item of message.messages) {
      assert.equal(typeof item, 'string')
    }
  }
}

function assertAlbumResourceContract (album) {
  assertExactKeys(album, ALBUM_RESOURCE_KEYS, 'AlbumResource')

  assertInteger(album.id, 'album.id')
  assertNullableString(album.title, 'album.title')
  assertNullableString(album.disambiguation, 'album.disambiguation')
  assertNullableString(album.overview, 'album.overview')
  assertInteger(album.artistId, 'album.artistId')
  assertNullableString(album.foreignAlbumId, 'album.foreignAlbumId')
  assert.equal(typeof album.monitored, 'boolean')
  assert.equal(typeof album.anyReleaseOk, 'boolean')
  assertInteger(album.profileId, 'album.profileId')
  assertInteger(album.duration, 'album.duration')
  assertNullableString(album.albumType, 'album.albumType')
  assert.ok(album.secondaryTypes === null || Array.isArray(album.secondaryTypes))
  assertInteger(album.mediumCount, 'album.mediumCount')
  assertRatingsContract(album.ratings, 'AlbumResource.ratings')
  assertNullableDateTime(album.releaseDate, 'album.releaseDate')
  assert.ok(album.releases === null || Array.isArray(album.releases))
  assert.ok(album.genres === null || Array.isArray(album.genres))
  assert.ok(album.media === null || Array.isArray(album.media))
  assert.ok(album.artist === null || typeof album.artist === 'object')
  assert.ok(album.images === null || Array.isArray(album.images))
  assert.ok(album.links === null || Array.isArray(album.links))
  assertNullableDateTime(album.lastSearchTime, 'album.lastSearchTime')
  assertExactKeys(album.statistics, ALBUM_STATISTICS_KEYS, 'AlbumStatisticsResource')
  assert.equal(typeof album.addOptions, 'object')
  assertNullableString(album.remoteCover, 'album.remoteCover')
}

function assertQueueResourceContract (item) {
  assertExactKeys(item, QUEUE_RESOURCE_KEYS, 'QueueResource')

  assertInteger(item.id, 'id')
  assertNullableInteger(item.artistId, 'artistId')
  assertNullableInteger(item.albumId, 'albumId')
  assert.ok(item.artist === null || typeof item.artist === 'object', 'artist must be ArtistResource or null')
  assert.ok(item.album === null || typeof item.album === 'object', 'album must be AlbumResource or null')
  if (item.album) assertAlbumResourceContract(item.album)
  assertQualityModelContract(item.quality)
  assert.ok(item.customFormats === null || Array.isArray(item.customFormats), 'customFormats must be CustomFormatResource[] or null')
  if (Array.isArray(item.customFormats)) {
    for (const format of item.customFormats) {
      assertCustomFormatContract(format)
    }
  }
  assertInteger(item.customFormatScore, 'customFormatScore')
  assert.equal(typeof item.size, 'number')
  assertNullableString(item.title, 'title')
  assert.equal(typeof item.sizeleft, 'number')
  assertNullableString(item.timeleft, 'timeleft')
  assertNullableDateTime(item.estimatedCompletionTime, 'estimatedCompletionTime')
  assertNullableDateTime(item.added, 'added')
  assertNullableString(item.status, 'status')
  assert.ok(item.trackedDownloadStatus === null || TRACKED_DOWNLOAD_STATUSES.includes(item.trackedDownloadStatus))
  assert.ok(item.trackedDownloadState === null || TRACKED_DOWNLOAD_STATES.includes(item.trackedDownloadState))
  assert.ok(item.statusMessages === null || Array.isArray(item.statusMessages), 'statusMessages must be TrackedDownloadStatusMessage[] or null')
  if (Array.isArray(item.statusMessages)) {
    for (const message of item.statusMessages) {
      assertStatusMessageContract(message)
    }
  }
  assertNullableString(item.errorMessage, 'errorMessage')
  assertNullableString(item.downloadId, 'downloadId')
  assert.ok(DOWNLOAD_PROTOCOLS.includes(item.protocol), 'protocol must serialize as DownloadProtocol enum string')
  assertNullableString(item.downloadClient, 'downloadClient')
  assert.equal(typeof item.downloadClientHasPostImportCategory, 'boolean')
  assertNullableString(item.indexer, 'indexer')
  assertNullableString(item.outputPath, 'outputPath')
  assertInteger(item.trackFileCount, 'trackFileCount')
  assertInteger(item.trackHasFileCount, 'trackHasFileCount')
  assert.equal(typeof item.downloadForced, 'boolean')
}

test('Lidarr queue details contract accepts empty result []', () => {
  assert.deepEqual(readFixture('queue-details-empty.golden.json'), [])
})

test('Lidarr queue details active fixture matches QueueResource source contract', () => {
  const fixture = readFixture('queue-details-active.golden.json')
  assert.equal(fixture.length, 1)
  assertQueueResourceContract(fixture[0])
  assert.equal(fixture[0].artist, null, 'QueueDetails includeArtist defaults to false')
  assert.equal(typeof fixture[0].album, 'object', 'QueueDetails includeAlbum defaults to true')
})

test('Lidarr queue details endpoint is a plain QueueResource[] not a paged wrapper', () => {
  const fixture = readFixture('queue-details-active.golden.json')
  assert.equal(Array.isArray(fixture), true)
  assert.equal(Object.prototype.hasOwnProperty.call(fixture, 'records'), false)
})

test('Lidarr QueueResource rejects common non-source approximations', () => {
  const bad = {
    records: readFixture('queue-details-active.golden.json'),
    page: 1,
    pageSize: 10,
    totalRecords: 1
  }

  assert.throws(() => assertQueueResourceContract(bad), /QueueResource keys drifted/)

  const badStatusMessage = {
    ...readFixture('queue-details-active.golden.json')[0],
    statusMessages: [{ reason: 'wrong shape' }]
  }

  assert.throws(() => assertQueueResourceContract(badStatusMessage), /TrackedDownloadStatusMessage keys drifted/)
})

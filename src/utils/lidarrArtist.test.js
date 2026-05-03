const assert = require('node:assert/strict')
const test = require('node:test')

const {
  LIDARR_LOOKUP_ARTIST_DEFAULTS,
  LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS,
  LIDARR_SKYHOOK_ARTIST_DEFAULTS,
  LIDARR_SKYHOOK_ARTIST_REQUIRED_KEYS,
  normalizeAliases,
  normalizeLidarrArtistResponse,
  normalizeStringArray,
  toSkyhookAlbumResource,
  toSkyhookArtistResource,
  withArtistLookupDefaults,
  withSkyhookArtistDefaults
} = require('./lidarrArtist')

test('withArtistLookupDefaults supplies Lidarr-safe lookup fields', () => {
  const artist = withArtistLookupDefaults({ artistName: ' Lorde ', aliases: [' ', 'Ella'] })

  for (const key of LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(artist, key), `lookup artist missing ${key}`)
  }

  assert.equal(artist.artistName, ' Lorde ')
  assert.equal(artist.id, '')
  assert.equal(artist.foreignArtistId, '')
  assert.equal(artist.status, LIDARR_LOOKUP_ARTIST_DEFAULTS.status)
  assert.deepEqual(artist.oldIds, [])
  assert.deepEqual(artist.aliases, ['Ella'])
  assert.deepEqual(artist.artistAliases, ['Ella'])
  assert.deepEqual(artist.links, [])
  assert.deepEqual(artist.images, [])
  assert.deepEqual(artist.albums, [])
})

test('withArtistLookupDefaults falls back foreignArtistId from id for legacy/cached payloads', () => {
  const artist = withArtistLookupDefaults({ artistName: 'Lorde', id: 'mb-legacy-1' })
  assert.equal(artist.id, 'mb-legacy-1')
  assert.equal(artist.foreignArtistId, 'mb-legacy-1')
})

test('withArtistLookupDefaults does not override an explicit foreignArtistId with id', () => {
  const artist = withArtistLookupDefaults({ artistName: 'Lorde', id: 'id-value', foreignArtistId: 'faid-value' })
  assert.equal(artist.id, 'id-value')
  assert.equal(artist.foreignArtistId, 'faid-value')
})

test('withArtistLookupDefaults backfills aliases for Lidarr add-artist payloads', () => {
  const artist = withArtistLookupDefaults({
    status: 'continuing',
    ended: false,
    artistName: 'The Beach Boys',
    foreignArtistId: 'ebfc1398-8d96-47e3-82c3-f782abcdb13d',
    qualityProfileId: 1,
    metadataProfileId: 1,
    monitored: true,
    monitorNewItems: 'all',
    folder: 'The Beach Boys',
    rootFolderPath: '/mnt/shared/Music',
    addOptions: { monitor: 'all', searchForMissingAlbums: false }
  })

  assert.ok(Object.prototype.hasOwnProperty.call(artist, 'aliases'))
  assert.ok(Object.prototype.hasOwnProperty.call(artist, 'artistAliases'))
  assert.ok(Object.prototype.hasOwnProperty.call(artist, 'oldIds'))
  assert.deepEqual(artist.oldIds, [])
  assert.deepEqual(artist.aliases, [])
  assert.deepEqual(artist.artistAliases, [])
  assert.equal(artist.qualityProfileId, 1)
  assert.equal(artist.metadataProfileId, 1)
  assert.equal(artist.rootFolderPath, '/mnt/shared/Music')
  assert.deepEqual(artist.addOptions, { monitor: 'all', searchForMissingAlbums: false })
})

test('withSkyhookArtistDefaults supplies SkyHook artist fields', () => {
  const artist = withSkyhookArtistDefaults({ artistName: 'Radiohead', aliases: ['On a Friday'] })

  for (const key of LIDARR_SKYHOOK_ARTIST_REQUIRED_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(artist, key), `SkyHook artist missing ${key}`)
  }

  assert.equal(artist.id, '')
  assert.equal(artist.artistName, 'Radiohead')
  assert.equal(artist.disambiguation, '')
  assert.equal(artist.overview, '')
  assert.equal(artist.type, LIDARR_SKYHOOK_ARTIST_DEFAULTS.type)
  assert.equal(artist.status, LIDARR_SKYHOOK_ARTIST_DEFAULTS.status)
  assert.deepEqual(artist.oldIds, [])
  assert.deepEqual(artist.aliases, ['On a Friday'])
  assert.deepEqual(artist.artistAliases, ['On a Friday'])
  assert.deepEqual(artist.links, [])
  assert.deepEqual(artist.images, [])
  assert.deepEqual(artist.albums, [])
})

test('normalizeStringArray trims values and drops blanks', () => {
  assert.deepEqual(normalizeStringArray([' One ', '', null, 42]), ['One', '42'])
  assert.deepEqual(normalizeStringArray('not-array'), [])
})

test('normalizeAliases accepts Lidarr PascalCase input and trims while preserving alias casing', () => {
  assert.deepEqual(normalizeAliases({ Aliases: [' Surf ', '', null] }), ['Surf'])
  assert.deepEqual(normalizeAliases({ ArtistAliases: [' Surf ', '', null] }), ['Surf'])
  assert.deepEqual(withArtistLookupDefaults({ artistName: 'The Beach Boys', Aliases: ['Beach Boys'] }).aliases, ['Beach Boys'])
  assert.deepEqual(withArtistLookupDefaults({ artistName: 'The Beach Boys', ArtistAliases: ['Beach Boys'] }).artistAliases, ['Beach Boys'])
})

test('normalizeAliases falls back from empty artistAliases to populated aliases', () => {
  assert.deepEqual(normalizeAliases({ artistAliases: [], aliases: ['BSB'] }), ['BSB'])
})

test('artist defaults preserve oldIds for Lidarr SkyHook metadata inserts', () => {
  assert.deepEqual(withArtistLookupDefaults({ artistName: 'Radiohead', OldIds: [' old-1 ', ''] }).oldIds, ['old-1'])
  assert.deepEqual(withSkyhookArtistDefaults({ artistName: 'Radiohead', oldIds: [' old-2 '] }).oldIds, ['old-2'])
})

test('normalizeLidarrArtistResponse injects aliases into artist-shaped responses', () => {
  const response = normalizeLidarrArtistResponse({
    status: 'continuing',
    ended: false,
    artistName: 'The Beach Boys',
    foreignArtistId: 'ebfc1398-8d96-47e3-82c3-f782abcdb13d',
    rootFolderPath: '/mnt/shared/Music',
    addOptions: { monitor: 'all', searchForMissingAlbums: false }
  })

  assert.deepEqual(response.aliases, [])
  assert.deepEqual(response.artistAliases, [])
  assert.deepEqual(response.oldIds, [])
  assert.equal(response.rootFolderPath, '/mnt/shared/Music')
  assert.deepEqual(response.addOptions, { monitor: 'all', searchForMissingAlbums: false })
})

test('normalizeLidarrArtistResponse injects aliases into Lidarr add payload with no albums', () => {
  const response = normalizeLidarrArtistResponse({
    status: 'continuing',
    ended: false,
    artistName: '*NSYNC',
    foreignArtistId: '603ba565-3967-4be1-931e-9cb945394e86',
    tadbId: 0,
    discogsId: 0,
    overview: '',
    disambiguation: 'US boy band',
    links: [],
    nextAlbum: null,
    lastAlbum: null,
    images: [
      {
        url: 'https://r2.theaudiodb.com/images/media/artist/thumb/wptpuu1359562857.jpg',
        coverType: 'poster',
        extension: '.jpg'
      }
    ],
    remotePoster: 'https://r2.theaudiodb.com/images/media/artist/thumb/wptpuu1359562857.jpg',
    qualityProfileId: 1,
    metadataProfileId: 1,
    monitored: true,
    monitorNewItems: 'all',
    folder: '-NSYNC',
    genres: [],
    tags: [],
    added: '0001-01-01T04:57:00Z',
    ratings: { votes: 0, value: 0 },
    addOptions: { monitor: 'all', searchForMissingAlbums: false },
    rootFolderPath: '/mnt/shared/Music'
  })

  assert.ok(Object.prototype.hasOwnProperty.call(response, 'aliases'))
  assert.ok(Object.prototype.hasOwnProperty.call(response, 'artistAliases'))
  assert.ok(Object.prototype.hasOwnProperty.call(response, 'oldIds'))
  assert.deepEqual(response.oldIds, [])
  assert.deepEqual(response.aliases, [])
  assert.deepEqual(response.artistAliases, [])
  assert.equal(response.artistName, '*NSYNC')
  assert.equal(response.folder, '-NSYNC')
})

test('normalizeLidarrArtistResponse injects artistAliases into Backstreet Boys add payload', () => {
  const response = normalizeLidarrArtistResponse({
    status: 'continuing',
    ended: false,
    artistName: 'Backstreet Boys',
    foreignArtistId: '2f569e60-0a1b-4fb9-95a4-3dc1525d1aad',
    tadbId: 0,
    discogsId: 0,
    overview: '',
    disambiguation: '',
    links: [],
    nextAlbum: null,
    lastAlbum: null,
    images: [
      {
        url: 'https://r2.theaudiodb.com/images/media/artist/thumb/urpspy1341340999.jpg',
        coverType: 'poster',
        extension: '.jpg'
      }
    ],
    remotePoster: 'https://r2.theaudiodb.com/images/media/artist/thumb/urpspy1341340999.jpg',
    qualityProfileId: 1,
    metadataProfileId: 1,
    monitored: true,
    monitorNewItems: 'all',
    folder: 'Backstreet Boys',
    genres: [],
    tags: [],
    added: '0001-01-01T04:57:00Z',
    ratings: { votes: 0, value: 0 },
    addOptions: { monitor: 'all', searchForMissingAlbums: false },
    rootFolderPath: '/mnt/shared/Music'
  })

  assert.deepEqual(response.aliases, [])
  assert.deepEqual(response.artistAliases, [])
  assert.deepEqual(response.oldIds, [])
  assert.equal(response.artistName, 'Backstreet Boys')
  assert.equal(response.foreignArtistId, '2f569e60-0a1b-4fb9-95a4-3dc1525d1aad')
})

test('normalizeLidarrArtistResponse injects aliases into nested SkyHook artists', () => {
  const response = normalizeLidarrArtistResponse([{ artist: { artistName: 'Radiohead', foreignArtistId: 'mb-1' } }])
  assert.deepEqual(response[0].artist.aliases, [])
  assert.deepEqual(response[0].artist.artistAliases, [])
  assert.deepEqual(response[0].artist.oldIds, [])
})

test('toSkyhookArtistResource emits only Lidarr ArtistResource fields', () => {
  const artist = toSkyhookArtistResource({
    id: 'mb-1',
    foreignArtistId: 'extra-id',
    artistName: 'Radiohead',
    aliases: ['On a Friday'],
    providerErrors: [],
    _generatedAt: '2026-05-03T00:00:00Z',
    albums: []
  })

  assert.deepEqual(Object.keys(artist).sort(), [
    'albums',
    'aristUrl',
    'artistAliases',
    'artistName',
    'disambiguation',
    'genres',
    'id',
    'images',
    'links',
    'oldIds',
    'overview',
    'rating',
    'status',
    'type'
  ].sort())
  assert.equal(artist.id, 'mb-1')
  assert.deepEqual(artist.artistAliases, ['On a Friday'])
  assert.equal(Object.prototype.hasOwnProperty.call(artist, 'foreignArtistId'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(artist, 'aliases'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(artist, 'providerErrors'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(artist, '_generatedAt'), false)
})

test('toSkyhookAlbumResource emits only Lidarr AlbumResource fields', () => {
  const album = toSkyhookAlbumResource({
    id: 'rg-1',
    foreignAlbumId: 'extra-album-id',
    title: 'OK Computer',
    artistId: 'artist-1',
    firstReleaseDate: '1997-05-21T00:00:00Z',
    releaseDate: '1997-05-21T00:00:00Z',
    remoteCover: 'https://example.com/cover.jpg',
    provider: 'musicbrainz',
    ids: { musicbrainzReleaseGroupId: 'rg-1' },
    artists: [{ id: 'artist-1', artistName: 'Radiohead' }],
    releases: [{
      id: 'rel-1',
      title: 'OK Computer',
      releaseDate: '1997-05-21T00:00:00Z',
      media: [{ name: 'CD 1', format: 'CD', position: 1 }],
      tracks: [{
        artistId: 'artist-1',
        durationMs: 240000,
        id: 'track-1',
        recordingId: 'rec-1',
        trackName: 'Airbag',
        trackNumber: '1',
        trackPosition: 1,
        mediumNumber: 1
      }]
    }]
  })

  assert.deepEqual(Object.keys(album).sort(), [
    'artistId',
    'artists',
    'disambiguation',
    'genres',
    'id',
    'images',
    'links',
    'oldIds',
    'overview',
    'rating',
    'releaseDate',
    'releaseStatuses',
    'releases',
    'secondaryTypes',
    'title',
    'type'
  ].sort())
  assert.equal(album.id, 'rg-1')
  assert.equal(album.releaseDate, '1997-05-21T00:00:00Z')
  assert.equal(album.releases[0].tracks[0].trackName, 'Airbag')
  assert.equal(Object.prototype.hasOwnProperty.call(album, 'foreignAlbumId'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(album, 'firstReleaseDate'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(album, 'remoteCover'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(album, 'provider'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(album, 'ids'), false)
})

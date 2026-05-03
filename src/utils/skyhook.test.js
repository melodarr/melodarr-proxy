const test = require('node:test')
const assert = require('node:assert/strict')

const { toSkyhookSearchShape } = require('./skyhook')

const STRICT_ARTIST_KEYS = [
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
]

const STRICT_ALBUM_KEYS = [
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
]

function assertExactKeys (value, keys, label) {
  assert.deepEqual(Object.keys(value).sort(), keys.sort(), `${label} keys drifted from Lidarr source contract`)
}

test('toSkyhookSearchShape — non-array input returns []', () => {
  assert.deepEqual(toSkyhookSearchShape(null), [])
  assert.deepEqual(toSkyhookSearchShape(undefined), [])
  assert.deepEqual(toSkyhookSearchShape({}), [])
  assert.deepEqual(toSkyhookSearchShape('nope'), [])
  assert.deepEqual(toSkyhookSearchShape(42), [])
})

test('toSkyhookSearchShape — empty array stays empty', () => {
  assert.deepEqual(toSkyhookSearchShape([]), [])
})

test('toSkyhookSearchShape — type=all artist candidate is an EntityResource with strict ArtistResource', () => {
  const out = toSkyhookSearchShape([{
    artistName: 'Radiohead',
    id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    type: 'artist',
    source: 'musicbrainz',
    disambiguation: '',
    score: 99,
    imageUrl: 'https://example.test/radiohead.jpg',
    ids: { musicbrainzArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' }
  }])

  assert.equal(out.length, 1)
  assert.deepEqual(Object.keys(out[0]).sort(), ['album', 'artist', 'score'])
  assert.equal(out[0].score, 99)
  assert.ok(out[0].artist, 'EntityResource.artist must be populated')
  assert.equal(out[0].album, null, 'EntityResource.album must be null for artist entries')

  const a = out[0].artist
  assertExactKeys(a, STRICT_ARTIST_KEYS, 'ArtistResource')
  assert.equal(a.id, 'a74b1b7f-71a5-4011-9441-d0b5e4122711')
  assert.equal(a.artistName, 'Radiohead')
  assert.equal(a.disambiguation, '')
  assert.equal(a.overview, '')
  assert.equal(a.type, 'Group')
  assert.equal(a.status, 'active')
  assert.deepEqual(a.oldIds, [])
  assert.deepEqual(a.artistAliases, [])
  assert.deepEqual(a.links, [])
  assert.deepEqual(a.images, [{
    coverType: 'poster',
    url: 'https://example.test/radiohead.jpg',
    height: 0,
    width: 0
  }])
  assert.deepEqual(a.albums, [])
})

test('toSkyhookSearchShape — artist falls back to ids.musicbrainzArtistId when id absent', () => {
  // MB candidates set id; iTunes/Discogs candidates only have
  // a per-source id under candidate.ids. The mapper should still find an MBID
  // there if present.
  const out = toSkyhookSearchShape([{
    artistName: 'Radiohead',
    type: 'artist',
    source: 'musicbrainz',
    ids: { musicbrainzArtistId: 'mb-id-here' }
  }])

  assert.equal(out[0].artist.id, 'mb-id-here')
})

test('toSkyhookSearchShape — non-MB artist candidates emit empty id (no synthesis)', () => {
  // iTunes/Discogs/TheAudioDB do not carry MBIDs. The mapper must NOT
  // synthesize a fake UUID — empty string preserves the truthful signal that
  // Lidarr cannot use this entry to add an artist.
  const out = toSkyhookSearchShape([{
    artistName: 'Radiohead',
    type: 'artist',
    source: 'itunes',
    ids: { itunesArtistId: '510227' }
  }])

  assert.equal(out[0].artist.id, '')
  assert.equal(out[0].artist.artistName, 'Radiohead')
})

test('toSkyhookSearchShape — type=all album candidate is an EntityResource with strict AlbumResource', () => {
  const out = toSkyhookSearchShape([{
    artistName: 'Radiohead',
    match: 'OK Computer',
    type: 'album',
    source: 'musicbrainz',
    score: 87,
    releaseDate: '1997-05-21T00:00:00Z',
    genres: ['Alternative Rock'],
    secondaryTypes: ['Studio'],
    images: [{ coverType: 'cover', url: 'https://example.test/ok.jpg' }],
    ids: {
      musicbrainzArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
      musicbrainzReleaseGroupId: 'b1392450-e666-3926-a536-22c65f834433'
    }
  }])

  assert.equal(out.length, 1)
  assert.deepEqual(Object.keys(out[0]).sort(), ['album', 'artist', 'score'])
  assert.equal(out[0].score, 87)
  assert.equal(out[0].artist, null)
  assert.ok(out[0].album)

  const al = out[0].album
  assertExactKeys(al, STRICT_ALBUM_KEYS, 'AlbumResource')
  assert.equal(al.id, 'b1392450-e666-3926-a536-22c65f834433')
  assert.deepEqual(al.oldIds, [])
  assert.equal(al.title, 'OK Computer')
  assert.equal(al.disambiguation, '')
  assert.equal(al.overview, '')
  assert.equal(al.artistId, 'a74b1b7f-71a5-4011-9441-d0b5e4122711')
  assert.equal(al.type, 'Album')
  assert.deepEqual(al.secondaryTypes, ['Studio'])
  assert.deepEqual(al.releaseStatuses, ['Official'])
  assert.deepEqual(al.rating, { count: 0, value: 0 })
  assert.equal(al.releaseDate, '1997-05-21T00:00:00Z')
  assert.deepEqual(al.releases, [])
  assert.deepEqual(al.genres, ['Alternative Rock'])
  assert.deepEqual(al.links, [])
  assert.deepEqual(al.images, [{
    coverType: 'cover',
    url: 'https://example.test/ok.jpg',
    height: 0,
    width: 0
  }])
  assert.equal(al.artists[0].id, 'a74b1b7f-71a5-4011-9441-d0b5e4122711')
  assert.equal(al.artists[0].artistName, 'Radiohead')
  assert.deepEqual(al.artists[0].artistAliases, [])
  assert.deepEqual(al.artists[0].oldIds, [])
  assert.deepEqual(al.artists[0].images, [])
  assert.deepEqual(al.artists[0].links, [])
})

test('toSkyhookSearchShape — type=artist returns ArtistResource[] not EntityResource[]', () => {
  const out = toSkyhookSearchShape([{
    artistName: 'Radiohead',
    type: 'artist',
    ids: { musicbrainzArtistId: 'artist-1' }
  }], 'artist')

  assert.equal(out.length, 1)
  assertExactKeys(out[0], STRICT_ARTIST_KEYS, 'ArtistResource')
  assert.equal(out[0].id, 'artist-1')
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], 'artist'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], 'album'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], 'score'), false)
})

test('toSkyhookSearchShape — type=album returns AlbumResource[] not EntityResource[]', () => {
  const out = toSkyhookSearchShape([{
    artistName: 'Radiohead',
    match: 'OK Computer',
    type: 'album',
    ids: {
      musicbrainzArtistId: 'artist-1',
      musicbrainzReleaseGroupId: 'album-1'
    }
  }], 'album')

  assert.equal(out.length, 1)
  assertExactKeys(out[0], STRICT_ALBUM_KEYS, 'AlbumResource')
  assert.equal(out[0].id, 'album-1')
  assert.equal(out[0].artistId, 'artist-1')
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], 'artist'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], 'album'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], 'score'), false)
})

test('toSkyhookSearchShape — artist images default to [] when candidate has none', () => {
  const out = toSkyhookSearchShape([{ artistName: 'No Image', type: 'artist', ids: {} }])
  assert.deepEqual(out[0].artist.images, [])
})

test('toSkyhookSearchShape — song candidates are filtered out (not in SkyHook search contract)', () => {
  // SkyHook search returns artist|album results only. Song candidates from
  // recording-level MB queries don't fit and must be dropped rather than
  // forced into either bucket with synthetic ids.
  const out = toSkyhookSearchShape([
    { artistName: 'Radiohead', type: 'song', source: 'musicbrainz', ids: {} },
    { artistName: 'Radiohead', type: 'artist', source: 'musicbrainz', ids: {} }
  ])

  assert.equal(out.length, 1, 'song dropped, artist kept')
  assert.ok(out[0].artist)
})

test('toSkyhookSearchShape — unknown/missing type defaults to artist', () => {
  // Defensive: if upstream omits type for an artist-shaped candidate (e.g.
  // legacy paths), wrap as artist rather than dropping it silently.
  const out = toSkyhookSearchShape([{ artistName: 'Radiohead', source: 'musicbrainz', ids: {} }])
  assert.equal(out.length, 1)
  assert.ok(out[0].artist)
  assert.equal(out[0].artist.artistName, 'Radiohead')
})

test('toSkyhookSearchShape — null/non-object entries are skipped', () => {
  const out = toSkyhookSearchShape([null, undefined, 'string', 42, { artistName: 'X', type: 'artist', ids: {} }])
  assert.equal(out.length, 1)
  assert.equal(out[0].artist.artistName, 'X')
})

test('toSkyhookSearchShape — output has stable required Lidarr fields (deserializer contract)', () => {
  // Source of truth:
  // NzbDrone.Core/MetadataSource/SkyHook/SkyHookProxy.SearchForNewEntity()
  // deserializes route=search&type=all as List<EntityResource>. EntityResource
  // has exactly Score, Artist, and Album; nested resources use the SkyHook
  // Resource classes, not Lidarr.Api.V1 resources.
  const out = toSkyhookSearchShape([
    { artistName: 'A', type: 'artist', ids: {} },
    { artistName: 'B', match: 'Album X', type: 'album', ids: {} }
  ])

  assert.deepEqual(Object.keys(out[0]).sort(), ['album', 'artist', 'score'])
  assert.deepEqual(Object.keys(out[1]).sort(), ['album', 'artist', 'score'])
  assertExactKeys(out[0].artist, STRICT_ARTIST_KEYS, 'ArtistResource')
  assertExactKeys(out[1].album, STRICT_ALBUM_KEYS, 'AlbumResource')
})

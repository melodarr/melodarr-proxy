const test = require('node:test')
const assert = require('node:assert/strict')

const { toSkyhookSearchShape } = require('./skyhook')

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

test('toSkyhookSearchShape — artist candidate is wrapped under "artist" key', () => {
  const out = toSkyhookSearchShape([{
    artistName: 'Radiohead',
    id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    type: 'artist',
    source: 'musicbrainz',
    disambiguation: '',
    imageUrl: 'https://example.test/radiohead.jpg',
    ids: { musicbrainzArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' }
  }])

  assert.equal(out.length, 1)
  assert.ok(out[0].artist, 'must be wrapped under "artist" key')
  assert.equal(out[0].album, undefined, 'must not also have "album" key')

  const a = out[0].artist
  assert.equal(a.id, 'a74b1b7f-71a5-4011-9441-d0b5e4122711')
  assert.equal(a.artistName, 'Radiohead')
  assert.equal(a.disambiguation, '')
  assert.equal(a.overview, '')
  assert.equal(a.type, 'Group')
  assert.equal(a.status, 'active')
  assert.deepEqual(a.aliases, [])
  assert.deepEqual(a.links, [])
  assert.deepEqual(a.images, [{
    coverType: 'poster',
    url: 'https://example.test/radiohead.jpg',
    remoteUrl: 'https://example.test/radiohead.jpg'
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

test('toSkyhookSearchShape — album candidate is wrapped under "album" key', () => {
  const out = toSkyhookSearchShape([{
    artistName: 'Radiohead',
    match: 'OK Computer',
    type: 'album',
    source: 'musicbrainz',
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
  assert.ok(out[0].album)
  assert.equal(out[0].artist, undefined)

  const al = out[0].album
  assert.equal(al.id, 'b1392450-e666-3926-a536-22c65f834433')
  assert.equal(al.title, 'OK Computer')
  assert.equal(al.disambiguation, '')
  assert.equal(al.overview, '')
  assert.equal(al.artistId, 'a74b1b7f-71a5-4011-9441-d0b5e4122711')
  assert.equal(al.monitored, false)
  assert.equal(al.anyReleaseOk, false)
  assert.equal(al.profileId, 0)
  assert.equal(al.duration, 0)
  assert.equal(al.albumType, 'Album')
  assert.deepEqual(al.secondaryTypes, ['Studio'])
  assert.equal(al.mediumCount, 0)
  assert.deepEqual(al.ratings, { votes: 0, value: 0 })
  assert.equal(al.releaseDate, '1997-05-21T00:00:00Z')
  assert.deepEqual(al.releases, [])
  assert.deepEqual(al.genres, ['Alternative Rock'])
  assert.deepEqual(al.media, [])
  assert.equal(al.artist.id, 'a74b1b7f-71a5-4011-9441-d0b5e4122711')
  assert.equal(al.artist.artistName, 'Radiohead')
  assert.deepEqual(al.artist.aliases, [])
  assert.deepEqual(al.links, [])
  assert.equal(al.lastSearchTime, null)
  assert.deepEqual(al.statistics, {
    albumCount: 0,
    songCount: 0,
    sizeOnDisk: 0,
    percentOfSongs: 0
  })
  assert.deepEqual(al.addOptions, {})
  assert.equal(al.remoteCover, 'https://example.test/ok.jpg')
  assert.deepEqual(al.images, [{
    coverType: 'cover',
    url: 'https://example.test/ok.jpg',
    remoteUrl: 'https://example.test/ok.jpg'
  }])
  assert.equal(al.artists[0].id, 'a74b1b7f-71a5-4011-9441-d0b5e4122711')
  assert.equal(al.artists[0].artistName, 'Radiohead')
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
  // This is the test that justifies the existence of this module. Lidarr's
  // SkyHook deserializer requires every artist entry to have these exact
  // keys; missing keys break the JSON contract even if every value is empty.
  const REQUIRED_ARTIST_KEYS = [
    'id', 'artistName', 'disambiguation', 'overview',
    'type', 'status', 'aliases', 'links', 'images', 'albums'
  ]
  const REQUIRED_ALBUM_KEYS = [
    'id', 'title', 'disambiguation', 'overview', 'artistId',
    'monitored', 'anyReleaseOk', 'profileId',
    'duration', 'albumType', 'secondaryTypes', 'mediumCount',
    'ratings', 'releaseDate', 'releases', 'genres', 'media',
    'artist', 'images', 'links', 'lastSearchTime', 'statistics',
    'addOptions', 'remoteCover', 'artists'
  ]

  const out = toSkyhookSearchShape([
    { artistName: 'A', type: 'artist', ids: {} },
    { artistName: 'B', match: 'Album X', type: 'album', ids: {} }
  ])

  for (const key of REQUIRED_ARTIST_KEYS) {
    assert.ok(key in out[0].artist, `artist must have key: ${key}`)
  }
  for (const key of REQUIRED_ALBUM_KEYS) {
    assert.ok(key in out[1].album, `album must have key: ${key}`)
  }
})

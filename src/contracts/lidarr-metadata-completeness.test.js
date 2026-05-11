const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  toSkyhookArtistResource,
  toSkyhookAlbumResource,
  withArtistLookupDefaults,
  SKYHOOK_IMAGE_REQUIRED_KEYS,
  SKYHOOK_LINK_REQUIRED_KEYS,
  SKYHOOK_RATING_REQUIRED_KEYS,
  SKYHOOK_ALBUM_REQUIRED_KEYS,
  SKYHOOK_ARTIST_RESOURCE_KEYS,
  SKYHOOK_RELEASE_REQUIRED_KEYS,
  SKYHOOK_TRACK_REQUIRED_KEYS,
  SKYHOOK_MEDIUM_REQUIRED_KEYS
} = require('../utils/lidarrArtist')

const VIVA_LAS_VENGEANCE_RELEASE_GROUP_ID = 'b8fee959-1da5-450b-8708-8f218f6414d4'
const VIVA_LAS_VENGEANCE_RELEASE_DATE = '2022-08-19T00:00:00Z'
const VIVA_LAS_VENGEANCE_COVER = `https://coverartarchive.org/release-group/${VIVA_LAS_VENGEANCE_RELEASE_GROUP_ID}/front`

// ─── § 1: IMAGE COMPLETENESS ──────────────────────────────────────────────────

describe('Image completeness', () => {
  it('normalizes camelCase image fields through artist serializer', () => {
    const artist = toSkyhookArtistResource({
      images: [{
        coverType: 'poster',
        url: 'https://example.test/poster.jpg',
        height: 600,
        width: 600
      }]
    })

    assert.equal(artist.images.length, 1)
    const img = artist.images[0]
    assert.deepStrictEqual(Object.keys(img).sort(), [...SKYHOOK_IMAGE_REQUIRED_KEYS].sort())
    assert.equal(img.coverType, 'poster')
    assert.equal(img.url, 'https://example.test/poster.jpg')
    assert.equal(img.height, 600)
    assert.equal(img.width, 600)
  })

  it('normalizes PascalCase image fields (CoverType, Url, Height, Width)', () => {
    const artist = toSkyhookArtistResource({
      Images: [{
        CoverType: 'fanart',
        Url: 'https://example.test/fanart.jpg',
        Height: 1080,
        Width: 1920
      }]
    })

    assert.equal(artist.images.length, 1)
    const img = artist.images[0]
    assert.equal(img.coverType, 'fanart')
    assert.equal(img.url, 'https://example.test/fanart.jpg')
    assert.equal(img.height, 1080)
    assert.equal(img.width, 1920)
  })

  it('falls back url from remoteUrl when url is missing', () => {
    const artist = toSkyhookArtistResource({
      images: [{
        coverType: 'cover',
        remoteUrl: 'https://coverartarchive.org/front-250.jpg'
      }]
    })

    assert.equal(artist.images[0].url, 'https://coverartarchive.org/front-250.jpg')
  })

  it('defaults missing image dimensions to 0', () => {
    const artist = toSkyhookArtistResource({
      images: [{ coverType: 'poster', url: 'https://example.test/img.jpg' }]
    })

    assert.equal(artist.images[0].height, 0)
    assert.equal(artist.images[0].width, 0)
  })

  it('defaults missing coverType to empty string', () => {
    const artist = toSkyhookArtistResource({
      images: [{ url: 'https://example.test/img.jpg' }]
    })

    assert.equal(artist.images[0].coverType, '')
  })

  it('strips non-schema keys from image objects (remoteUrl, imageSource)', () => {
    const artist = toSkyhookArtistResource({
      images: [{
        coverType: 'poster',
        url: 'https://example.test/img.jpg',
        remoteUrl: 'https://example.test/img.jpg',
        imageSource: 'audiodb',
        _internal: true,
        height: 500,
        width: 500
      }]
    })

    const img = artist.images[0]
    assert.deepStrictEqual(Object.keys(img).sort(), [...SKYHOOK_IMAGE_REQUIRED_KEYS].sort())
    assert.equal('remoteUrl' in img, false, 'remoteUrl should be stripped')
    assert.equal('imageSource' in img, false, 'imageSource should be stripped')
    assert.equal('_internal' in img, false, '_internal should be stripped')
  })

  it('produces empty array for null/undefined/non-array images', () => {
    assert.deepStrictEqual(toSkyhookArtistResource({ images: null }).images, [])
    assert.deepStrictEqual(toSkyhookArtistResource({ images: undefined }).images, [])
    assert.deepStrictEqual(toSkyhookArtistResource({ images: 'not-array' }).images, [])
    assert.deepStrictEqual(toSkyhookArtistResource({}).images, [])
  })

  it('preserves image ordering from input', () => {
    const artist = toSkyhookArtistResource({
      images: [
        { coverType: 'poster', url: 'https://example.test/1.jpg' },
        { coverType: 'fanart', url: 'https://example.test/2.jpg' },
        { coverType: 'clearlogo', url: 'https://example.test/3.png' }
      ]
    })

    assert.equal(artist.images.length, 3)
    assert.deepStrictEqual(
      artist.images.map(i => i.coverType),
      ['poster', 'fanart', 'clearlogo']
    )
  })

  it('normalizes album images through toSkyhookAlbumResource consistently', () => {
    const album = toSkyhookAlbumResource({
      images: [{
        CoverType: 'cover',
        remoteUrl: 'https://coverartarchive.org/front.jpg',
        imageSource: 'coverartarchive'
      }]
    })

    assert.equal(album.images.length, 1)
    const img = album.images[0]
    assert.deepStrictEqual(Object.keys(img).sort(), [...SKYHOOK_IMAGE_REQUIRED_KEYS].sort())
    assert.equal(img.url, 'https://coverartarchive.org/front.jpg')
    assert.equal('imageSource' in img, false)
  })
})

// ─── § 2: RATING NORMALIZATION ────────────────────────────────────────────────

describe('Rating normalization', () => {
  it('produces safe defaults from null rating', () => {
    const artist = toSkyhookArtistResource({ rating: null })
    assert.deepStrictEqual(artist.rating, { count: 0, value: 0 })
  })

  it('produces safe defaults from undefined rating', () => {
    const artist = toSkyhookArtistResource({})
    assert.deepStrictEqual(artist.rating, { count: 0, value: 0 })
  })

  it('produces safe defaults from empty object rating', () => {
    const artist = toSkyhookArtistResource({ rating: {} })
    assert.deepStrictEqual(artist.rating, { count: 0, value: 0 })
  })

  it('preserves valid rating with count/value', () => {
    const artist = toSkyhookArtistResource({
      rating: { count: 1500, value: 4.2 }
    })

    assert.deepStrictEqual(artist.rating, { count: 1500, value: 4.2 })
  })

  it('maps votes→count for SkyHook rating schema', () => {
    const artist = toSkyhookArtistResource({
      rating: { votes: 800, value: 3.9 }
    })

    assert.deepStrictEqual(artist.rating, { count: 800, value: 3.9 })
  })

  it('coerces string numbers in ratings', () => {
    const artist = toSkyhookArtistResource({
      rating: { count: '250', value: '3.7' }
    })

    assert.equal(artist.rating.count, 250)
    assert.equal(artist.rating.value, 3.7)
  })

  it('coerces NaN rating values to 0', () => {
    const artist = toSkyhookArtistResource({
      rating: { count: 'abc', value: 'xyz' }
    })

    assert.equal(artist.rating.count, 0)
    assert.equal(artist.rating.value, 0)
  })

  it('rating output always matches SKYHOOK_RATING_REQUIRED_KEYS exactly', () => {
    const inputs = [
      null,
      undefined,
      {},
      { count: 10, value: 3.5 },
      { votes: 20, value: 4.0 },
      { count: 'abc', value: NaN }
    ]

    for (const input of inputs) {
      const artist = toSkyhookArtistResource({ rating: input })
      assert.deepStrictEqual(
        Object.keys(artist.rating).sort(),
        [...SKYHOOK_RATING_REQUIRED_KEYS].sort(),
        `Rating keys mismatch for input: ${JSON.stringify(input)}`
      )
    }
  })

  it('album rating normalization matches artist rating shape', () => {
    const album = toSkyhookAlbumResource({
      rating: { votes: 500, value: 4.1 }
    })

    assert.deepStrictEqual(
      Object.keys(album.rating).sort(),
      [...SKYHOOK_RATING_REQUIRED_KEYS].sort()
    )
    // SkyHook uses count, not votes
    assert.equal(album.rating.count, 500)
    assert.equal(album.rating.value, 4.1)
  })

  it('artist and album serializers produce identical rating shape for same input', () => {
    const input = { count: 300, value: 3.6 }

    const artistRating = toSkyhookArtistResource({ rating: input }).rating
    const albumRating = toSkyhookAlbumResource({ rating: input }).rating

    assert.deepStrictEqual(artistRating, albumRating,
      'Artist and album rating serialization must be identical for same input')
  })

  it('falls back to ratings field when rating is missing', () => {
    const artist = toSkyhookArtistResource({
      ratings: { votes: 100, value: 3.2 }
    })

    assert.equal(artist.rating.count, 100)
    assert.equal(artist.rating.value, 3.2)
  })
})

// ─── § 3: LINK CONSISTENCY ────────────────────────────────────────────────────

describe('Link consistency', () => {
  it('normalizes camelCase link fields', () => {
    const artist = toSkyhookArtistResource({
      links: [{ target: 'https://spotify.com/artist/123', type: 'spotify' }]
    })

    assert.equal(artist.links.length, 1)
    const link = artist.links[0]
    assert.deepStrictEqual(Object.keys(link).sort(), [...SKYHOOK_LINK_REQUIRED_KEYS].sort())
    assert.equal(link.target, 'https://spotify.com/artist/123')
    assert.equal(link.type, 'spotify')
  })

  it('normalizes PascalCase link fields (Target, Type)', () => {
    const artist = toSkyhookArtistResource({
      Links: [{ Target: 'https://example.test', Type: 'official' }]
    })

    assert.equal(artist.links.length, 1)
    assert.equal(artist.links[0].target, 'https://example.test')
    assert.equal(artist.links[0].type, 'official')
  })

  it('falls back url→target and name→type for provider-shaped links', () => {
    const artist = toSkyhookArtistResource({
      links: [{ url: 'https://twitter.com/artist', name: 'twitter' }]
    })

    assert.equal(artist.links[0].target, 'https://twitter.com/artist')
    assert.equal(artist.links[0].type, 'twitter')
  })

  it('defaults missing link fields to empty string', () => {
    const artist = toSkyhookArtistResource({
      links: [{}]
    })

    assert.equal(artist.links[0].target, '')
    assert.equal(artist.links[0].type, '')
  })

  it('strips non-schema keys from link objects', () => {
    const artist = toSkyhookArtistResource({
      links: [{
        target: 'https://example.test',
        type: 'official',
        _source: 'musicbrainz',
        verified: true
      }]
    })

    const link = artist.links[0]
    assert.deepStrictEqual(Object.keys(link).sort(), [...SKYHOOK_LINK_REQUIRED_KEYS].sort())
    assert.equal('_source' in link, false)
    assert.equal('verified' in link, false)
  })

  it('produces empty array for null/undefined/non-array links', () => {
    assert.deepStrictEqual(toSkyhookArtistResource({ links: null }).links, [])
    assert.deepStrictEqual(toSkyhookArtistResource({ links: undefined }).links, [])
    assert.deepStrictEqual(toSkyhookArtistResource({ links: 'not-array' }).links, [])
    assert.deepStrictEqual(toSkyhookArtistResource({}).links, [])
  })

  it('album links match same schema as artist links', () => {
    const album = toSkyhookAlbumResource({
      links: [{ Target: 'https://example.test', Type: 'official' }]
    })

    assert.equal(album.links.length, 1)
    assert.deepStrictEqual(
      Object.keys(album.links[0]).sort(),
      [...SKYHOOK_LINK_REQUIRED_KEYS].sort()
    )
  })
})

// ─── § 4: CROSS-SERIALIZER CONSISTENCY ────────────────────────────────────────

describe('Cross-serializer consistency', () => {
  const fullProvider = {
    artistName: 'Test Artist',
    id: 'abc-123',
    genres: ['Rock', 'Alternative'],
    overview: 'A test artist',
    disambiguation: 'UK band',
    type: 'Group',
    status: 'active',
    rating: { count: 500, value: 4.0 },
    images: [
      { coverType: 'poster', url: 'https://example.test/poster.jpg', remoteUrl: 'https://example.test/poster.jpg', imageSource: 'audiodb', height: 1000, width: 1000 },
      { coverType: 'fanart', url: 'https://example.test/fanart.jpg', height: 1080, width: 1920 }
    ],
    links: [
      { target: 'https://spotify.com/artist/abc', type: 'spotify' },
      { url: 'https://musicbrainz.org/artist/abc', name: 'musicbrainz' }
    ],
    albums: [{
      title: 'Test Album',
      id: 'album-1',
      type: 'Album',
      releaseDate: '2020-03-15',
      rating: { count: 200, value: 3.8 },
      images: [{ coverType: 'cover', url: 'https://example.test/cover.jpg', imageSource: 'coverartarchive' }],
      links: [{ target: 'https://example.test/album', type: 'official' }],
      releases: [{
        id: 'rel-1',
        title: 'Test Album (Deluxe)',
        status: 'Official',
        tracks: [{ id: 'trk-1', trackName: 'Track 1', durationMs: 240000 }],
        media: [{ name: 'CD', format: 'CD', position: 1 }]
      }],
      artists: [{
        artistName: 'Featured Artist',
        id: 'feat-1',
        images: [{ coverType: 'poster', url: 'https://example.test/feat.jpg', _extra: 'should-strip' }]
      }]
    }]
  }

  it('artist serializer strips all non-schema keys from full provider output', () => {
    const result = toSkyhookArtistResource(fullProvider)
    assert.deepStrictEqual(Object.keys(result).sort(), [...SKYHOOK_ARTIST_RESOURCE_KEYS].sort())
  })

  it('artist nested albums use full AlbumResource schema from full provider', () => {
    const result = toSkyhookArtistResource(fullProvider)
    const album = result.albums[0]
    assert.deepStrictEqual(Object.keys(album).sort(), [...SKYHOOK_ALBUM_REQUIRED_KEYS].sort())
  })

  it('artist nested albums preserve fields Lidarr uses for artist-page status', () => {
    const result = toSkyhookArtistResource(fullProvider)
    const album = result.albums[0]
    assert.equal(album.images.length, 1)
    assert.equal(album.artists.length, 1)
    assert.equal(album.releases.length, 1)
    assert.equal(album.releases[0].trackCount, 1)
    assert.equal(album.releases[0].tracks.length, 1)
  })

  it('album images strip provider-layer keys through full album serialization', () => {
    const album = toSkyhookAlbumResource(fullProvider.albums[0])
    const albumImg = album.images[0]
    assert.deepStrictEqual(Object.keys(albumImg).sort(), [...SKYHOOK_IMAGE_REQUIRED_KEYS].sort())
    assert.equal('imageSource' in albumImg, false)
  })

  it('nested artist-in-album images strip extra keys through full album serialization', () => {
    const album = toSkyhookAlbumResource(fullProvider.albums[0])
    const nestedArtistImg = album.artists[0].images[0]
    assert.deepStrictEqual(Object.keys(nestedArtistImg).sort(), [...SKYHOOK_IMAGE_REQUIRED_KEYS].sort())
    assert.equal('_extra' in nestedArtistImg, false)
  })

  it('provider url→target link fallback works through full serialization path', () => {
    const result = toSkyhookArtistResource(fullProvider)
    const mbLink = result.links[1]
    assert.equal(mbLink.target, 'https://musicbrainz.org/artist/abc')
    assert.equal(mbLink.type, 'musicbrainz')
  })

  it('nested release/track/medium have correct schemas through full album serialization path', () => {
    const album = toSkyhookAlbumResource(fullProvider.albums[0])
    const release = album.releases[0]
    assert.deepStrictEqual(Object.keys(release).sort(), [...SKYHOOK_RELEASE_REQUIRED_KEYS].sort())

    const track = release.tracks[0]
    assert.deepStrictEqual(Object.keys(track).sort(), [...SKYHOOK_TRACK_REQUIRED_KEYS].sort())

    const medium = release.media[0]
    assert.deepStrictEqual(Object.keys(medium).sort(), [...SKYHOOK_MEDIUM_REQUIRED_KEYS].sort())
  })

  it('artist nested album and full album resource keep matching rating shape', () => {
    const albumInput = fullProvider.albums[0]

    const fromArtist = toSkyhookArtistResource(fullProvider).albums[0]
    const fromDirect = toSkyhookAlbumResource(albumInput)

    assert.deepStrictEqual(
      Object.keys(fromArtist.rating).sort(),
      Object.keys(fromDirect.rating).sort()
    )
  })
})

// ─── § 5: RELEASE/TRACK/MEDIUM EDGE CASES ────────────────────────────────────

describe('Release/track/medium edge cases', () => {
  it('release with null media/tracks produces empty arrays', () => {
    const album = toSkyhookAlbumResource({
      releases: [{ id: 'rel-1', title: 'Test', media: null, tracks: null }]
    })

    assert.deepStrictEqual(album.releases[0].media, [])
    assert.deepStrictEqual(album.releases[0].tracks, [])
  })

  it('release defaults status to Official when missing', () => {
    const album = toSkyhookAlbumResource({
      releases: [{ id: 'rel-1', title: 'Test' }]
    })

    assert.equal(album.releases[0].status, 'Official')
  })

  it('track with PascalCase input normalizes correctly', () => {
    const album = toSkyhookAlbumResource({
      releases: [{
        id: 'rel-1',
        tracks: [{
          ArtistId: 'art-1',
          DurationMs: 300000,
          Id: 'trk-1',
          OldIds: ['old-1'],
          RecordingId: 'rec-1',
          OldRecordingIds: ['old-rec-1'],
          TrackName: 'PascalCase Track',
          TrackNumber: '3',
          TrackPosition: 3,
          Explicit: true,
          MediumNumber: 1
        }]
      }]
    })

    const track = album.releases[0].tracks[0]
    assert.deepStrictEqual(Object.keys(track).sort(), [...SKYHOOK_TRACK_REQUIRED_KEYS].sort())
    assert.equal(track.artistId, 'art-1')
    assert.equal(track.durationMs, 300000)
    assert.equal(track.trackName, 'PascalCase Track')
    assert.equal(track.explicit, true)
    assert.equal(track.mediumNumber, 1)
    assert.deepStrictEqual(track.oldIds, ['old-1'])
    assert.deepStrictEqual(track.oldRecordingIds, ['old-rec-1'])
  })

  it('medium defaults missing fields to safe values', () => {
    const album = toSkyhookAlbumResource({
      releases: [{
        id: 'rel-1',
        media: [{}]
      }]
    })

    const medium = album.releases[0].media[0]
    assert.deepStrictEqual(Object.keys(medium).sort(), [...SKYHOOK_MEDIUM_REQUIRED_KEYS].sort())
    assert.equal(medium.name, '')
    assert.equal(medium.format, '')
    assert.equal(medium.position, 0)
  })

  it('album releaseStatuses defaults to [Official] when empty', () => {
    const album = toSkyhookAlbumResource({ releaseStatuses: [] })
    assert.deepStrictEqual(album.releaseStatuses, ['Official'])
  })

  it('album releaseStatuses defaults to [Official] when missing', () => {
    const album = toSkyhookAlbumResource({})
    assert.deepStrictEqual(album.releaseStatuses, ['Official'])
  })

  it('album type defaults to Album when missing', () => {
    const album = toSkyhookAlbumResource({})
    assert.equal(album.type, 'Album')
  })

  it('album releaseDate defaults to null when missing', () => {
    const album = toSkyhookAlbumResource({})
    assert.equal(album.releaseDate, null)
  })

  it('preserves fallback release-group browse data lacking tracks with compatibility fields', () => {
    const artist = withArtistLookupDefaults({
      artistName: 'Panic! at the Disco',
      id: 'b9472588-93f3-4922-a1a2-74082cdf9ce8',
      albums: [{
        id: VIVA_LAS_VENGEANCE_RELEASE_GROUP_ID,
        title: 'Viva Las Vengeance',
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
        remoteCover: VIVA_LAS_VENGEANCE_COVER,
        releases: [{
          id: 'browse-release-without-tracks',
          title: 'Viva Las Vengeance',
          releaseDate: VIVA_LAS_VENGEANCE_RELEASE_DATE,
          status: 'Official',
          trackCount: 0,
          media: [{
            name: 'Digital Media',
            format: 'Digital Media',
            position: 1
          }]
        }]
      }]
    })

    const album = artist.albums[0]
    assert.equal(album.id, VIVA_LAS_VENGEANCE_RELEASE_GROUP_ID)
    assert.equal(album.title, 'Viva Las Vengeance')
    assert.equal(album.releaseDate, VIVA_LAS_VENGEANCE_RELEASE_DATE)
    assert.equal(album.provider, 'musicbrainz')
    assert.equal(album.ids.musicbrainzReleaseGroupId, VIVA_LAS_VENGEANCE_RELEASE_GROUP_ID)
    assert.equal(album.remoteCover, VIVA_LAS_VENGEANCE_COVER)
    assert.equal(album.images[0].url, VIVA_LAS_VENGEANCE_COVER)
    assert.equal(album.images[0].remoteUrl, VIVA_LAS_VENGEANCE_COVER)

    const release = album.releases[0]
    assert.equal(release.id, 'browse-release-without-tracks')
    assert.equal(release.trackCount, 0)
    assert.deepEqual(release.tracks, [])
    assert.deepEqual(release.media, [{
      name: 'Digital Media',
      format: 'Digital Media',
      position: 1
    }])
  })
})

const test = require('node:test')
const assert = require('node:assert')
const { toSkyhookAlbumResource, withArtistLookupDefaults } = require('../utils/lidarrArtist')
const { toSkyhookSearchShape } = require('../utils/skyhook')

function setupMocks () {
  delete require.cache[require.resolve('./musicbrainz.provider')]

  let musicBrainzGetMock = async () => {}

  require.cache[require.resolve('../services/upstream.service')] = {
    exports: {
      musicBrainzGet: async (path, params) => musicBrainzGetMock(path, params)
    }
  }

  const musicbrainzProvider = require('./musicbrainz.provider')
  return { musicbrainzProvider, setMock: (fn) => { musicBrainzGetMock = fn } }
}

function makeMusicBrainzTracks (count, artistId = 'artist-panic') {
  return Array.from({ length: count }, (_, index) => {
    const position = index + 1
    return {
      id: `track-${position}`,
      title: `Track ${position}`,
      number: String(position),
      position,
      length: 180000 + position,
      recording: {
        id: `recording-${position}`,
        title: `Track ${position}`,
        length: 180000 + position,
        'artist-credit': [{
          artist: {
            id: artistId,
            name: 'Panic! at the Disco'
          }
        }]
      }
    }
  })
}

test('MusicBrainz Provider', async (t) => {
  await t.test('searchArtist - returns exact artist match and albums', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    setMock(async (path, params) => {
      if (path === '/artist') {
        return {
          artists: [
            {
              id: '123',
              name: 'exact match',
              'sort-name': 'exact match',
              aliases: [
                { name: ' Exact Alias ' },
                { 'sort-name': 'Sort Alias' },
                { name: '' }
              ]
            }
          ]
        }
      }
      if (path === '/release-group') {
        assert.strictEqual(params.inc, 'ratings')
        return {
          'release-groups': [
            { id: 'rg1', title: 'Album 1', 'primary-type': 'Album', 'first-release-date': '2020-01-01', rating: { value: 4.25, 'votes-count': 12 } },
            { id: 'rg2', title: 'EP 1', 'primary-type': 'EP', 'secondary-types': ['Compilation'] }, // filtered out
            { id: 'rg3', title: 'Album 2', 'primary-type': 'Album' },
            { id: 'rg4', title: 'Album 3', 'primary-type': 'Album' }
          ]
        }
      }
    })

    const result = await musicbrainzProvider.searchArtist('exact match')
    assert.strictEqual(result.artistName, 'exact match')
    assert.strictEqual(result.albums.length, 3)
    assert.strictEqual(result.albums[0].name, 'Album 1')
    assert.strictEqual(result.albums[0].year, 2020)
    // v0.3.36: full date preserved alongside year.
    assert.strictEqual(result.albums[0].releaseDate, '2020-01-01')
    assert.ok(result.albums[0].imageUrl.includes('rg1'))
    assert.deepStrictEqual(result.albums[0].rating, { count: 12, value: 4.25 })
    assert.deepStrictEqual(result.albums[0].ratings, { votes: 12, value: 4.25 })
    // Browse API does not include releases (inc=releases is lookup-only),
    // so trackCount defaults to 0 for browse-sourced release groups.
    assert.strictEqual(result.albums[0].trackCount, 0)
    assert.strictEqual(result.albums[1].name, 'Album 2')
    assert.strictEqual(result.albums[1].year, null)
    assert.strictEqual(result.albums[1].releaseDate, null)
    assert.strictEqual(result.albums[1].trackCount, 0)
    assert.strictEqual(result.albums[2].name, 'Album 3')
    assert.strictEqual(result.albums[2].trackCount, 0)
    assert.deepStrictEqual(result.oldIds, [])
    assert.deepStrictEqual(result.aliases, ['Exact Alias', 'Sort Alias'])
    assert.deepStrictEqual(result.artistAliases, ['Exact Alias', 'Sort Alias'])
  })

  await t.test('searchArtist - maps MusicBrainz aliases through to Lidarr artistAliases', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    setMock(async (path) => {
      if (path === '/artist') {
        return {
          artists: [
            {
              id: '2f569e60-0a1b-4fb9-95a4-3dc1525d1aad',
              name: 'Backstreet Boys',
              'sort-name': 'Backstreet Boys',
              aliases: [
                { name: ' BSB ' },
                { name: 'Backstreet' }
              ]
            }
          ]
        }
      }
      if (path === '/release-group') {
        return { 'release-groups': [] }
      }
    })

    const musicBrainzArtist = await musicbrainzProvider.searchArtist('Backstreet Boys')
    const lidarrArtist = toSkyhookSearchShape([{
      ...musicBrainzArtist,
      type: 'artist',
      ids: { musicbrainzArtistId: musicBrainzArtist.id }
    }], 'artist')[0]

    assert.deepStrictEqual(musicBrainzArtist.aliases, ['BSB', 'Backstreet'])
    assert.deepStrictEqual(musicBrainzArtist.artistAliases, ['BSB', 'Backstreet'])
    assert.deepStrictEqual(lidarrArtist.oldIds, [])
    assert.strictEqual(Object.prototype.hasOwnProperty.call(lidarrArtist, 'aliases'), false)
    assert.deepStrictEqual(lidarrArtist.artistAliases, ['BSB', 'Backstreet'])
  })

  await t.test('searchArtist - returns empty if no artist found', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    setMock(async (path, params) => {
      if (path === '/artist') return { artists: [] }
    })

    const result = await musicbrainzProvider.searchArtist('not found')
    assert.strictEqual(result.artistName, 'not found')
    assert.strictEqual(result.albums.length, 0)
  })

  await t.test('lookupArtistById - returns artist and albums by MBID', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    setMock(async (path, params) => {
      if (path === '/artist/a74b1b7f') {
        assert.strictEqual(params.inc, 'aliases')
        return {
          id: 'a74b1b7f',
          name: 'Radiohead',
          disambiguation: 'test artist',
          aliases: [
            { name: 'On a Friday' }
          ]
        }
      }
      if (path === '/release-group') {
        assert.strictEqual(params.artist, 'a74b1b7f')
        assert.strictEqual(params.inc, 'ratings')
        return {
          'release-groups': [
            { id: 'rg1', title: 'OK Computer', 'primary-type': 'Album', 'first-release-date': '1997-05-21', rating: { value: 4.5, 'votes-count': 42 } }
          ]
        }
      }
    })

    const result = await musicbrainzProvider.lookupArtistById('a74b1b7f')
    assert.strictEqual(result.artistName, 'Radiohead')
    assert.strictEqual(result.id, 'a74b1b7f')
    assert.strictEqual(result.albums.length, 1)
    assert.strictEqual(result.albums[0].provider, 'musicbrainz')
    assert.deepStrictEqual(result.albums[0].rating, { count: 42, value: 4.5 })
    assert.deepStrictEqual(result.albums[0].ratings, { votes: 42, value: 4.5 })
    assert.strictEqual(result.providers[0].name, 'musicbrainz')
    assert.deepStrictEqual(result.oldIds, [])
    assert.deepStrictEqual(result.aliases, ['On a Friday'])
    assert.deepStrictEqual(result.artistAliases, ['On a Friday'])
    assert.deepStrictEqual(withArtistLookupDefaults(result).artistAliases, ['On a Friday'])
  })

  await t.test('lookupArtistById - preserves Album and EP primary types for Lidarr metadata filtering', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    setMock(async (path) => {
      if (path === '/artist/artist-types') {
        return {
          id: 'artist-types',
          name: 'Type Artist'
        }
      }
      if (path === '/release-group') {
        return {
          'release-groups': [
            { id: 'rg-album', title: 'Album Type', 'primary-type': 'Album', 'first-release-date': '2020' },
            { id: 'rg-ep', title: 'EP Type', 'primary-type': 'EP', 'first-release-date': '2021' },
            { id: 'rg-single', title: 'Single Type', 'primary-type': 'Single', 'first-release-date': '2022' },
            { id: 'rg-live', title: 'Live Album', 'primary-type': 'Album', 'secondary-types': ['Live'], 'first-release-date': '2023' }
          ]
        }
      }
    })

    const result = await musicbrainzProvider.lookupArtistById('artist-types')

    assert.deepStrictEqual(result.albums.map(album => album.name), ['Album Type', 'EP Type'])
    assert.deepStrictEqual(result.albums.map(album => album.type), ['Album', 'EP'])
    assert.deepStrictEqual(result.albums.map(album => album.albumType), ['Album', 'EP'])
    assert.deepStrictEqual(result.albums.map(album => album.secondaryTypes), [[], []])
    assert.deepStrictEqual(result.albums.map(album => album.releaseStatuses), [['Official'], ['Official']])
  })

  await t.test('lookupArtistById - handles large valid discographies deterministically', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    const releaseGroups = Array.from({ length: 100 }, (_, index) => ({
      id: `rg-${index + 1}`,
      title: `Album ${index + 1}`,
      'primary-type': index % 2 === 0 ? 'Album' : 'EP',
      'first-release-date': `${2000 + (index % 20)}-01-01`,
      rating: { value: 3 + (index % 3), 'votes-count': index + 1 }
    }))

    setMock(async (path) => {
      if (path === '/artist/large-artist') {
        return {
          id: 'large-artist',
          name: 'Large Artist'
        }
      }
      if (path === '/release-group') {
        return { 'release-groups': releaseGroups }
      }
    })

    const result = await musicbrainzProvider.lookupArtistById('large-artist')

    assert.strictEqual(result.albums.length, 100)
    assert.strictEqual(result.providers[0].albumCount, 100)
    assert.deepStrictEqual(result.albums.slice(0, 3).map(album => album.name), ['Album 1', 'Album 2', 'Album 3'])
    assert.deepStrictEqual(result.albums.slice(0, 4).map(album => album.type), ['Album', 'EP', 'Album', 'EP'])
    assert.deepStrictEqual(result.albums[0].rating, { count: 1, value: 3 })
    assert.deepStrictEqual(result.albums[99].rating, { count: 100, value: 3 })
  })

  await t.test('lookupArtistById - enriches release group summaries with looked-up release tracks', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    const releaseGroupId = 'b8a4f1e0-viva-las-vengeance'
    const releaseDate = '2022-08-19T00:00:00Z'
    const calls = []

    setMock(async (path, params) => {
      calls.push({ path, params })

      if (path === '/artist/artist-panic') {
        return {
          id: 'artist-panic',
          name: 'Panic! at the Disco'
        }
      }
      if (path === '/release-group') {
        return {
          'release-groups': [{
            id: releaseGroupId,
            title: 'Viva Las Vengeance',
            'primary-type': 'Album',
            'first-release-date': releaseDate
          }]
        }
      }
      if (path === '/release') {
        assert.strictEqual(params.artist, 'artist-panic')
        assert.strictEqual(params.inc, 'release-groups+media+recordings+artist-credits')
        return {
          releases: [{
            id: 'release-viva-las-vengeance',
            title: 'Viva Las Vengeance',
            date: releaseDate,
            status: 'Official',
            country: 'US',
            'release-group': { id: releaseGroupId },
            media: [{
              title: 'Digital Media',
              format: 'Digital Media',
              position: 1,
              tracks: makeMusicBrainzTracks(12)
            }]
          }]
        }
      }
    })

    const result = await musicbrainzProvider.lookupArtistById('artist-panic')
    const album = result.albums[0]
    const expectedCover = `https://coverartarchive.org/release-group/${releaseGroupId}/front`

    assert.strictEqual(album.id, releaseGroupId)
    assert.strictEqual(album.title, 'Viva Las Vengeance')
    assert.strictEqual(album.releaseDate, releaseDate)
    assert.strictEqual(album.imageUrl, expectedCover)
    assert.strictEqual(album.remoteCover, expectedCover)
    assert.deepStrictEqual(album.images, [{
      coverType: 'cover',
      url: expectedCover,
      remoteUrl: expectedCover
    }])
    assert.strictEqual(album.trackCount, 12)
    assert.strictEqual(album.releases.length, 1)
    assert.strictEqual(album.releases[0].trackCount, 12)
    assert.strictEqual(album.releases[0].tracks.length, 12)
    assert.strictEqual(album.releases[0].tracks[0].trackName, 'Track 1')
    assert.strictEqual(album.releases[0].tracks[11].trackName, 'Track 12')
    assert.strictEqual(calls.filter(call => call.path === '/release').length, 1)
  })

  await t.test('lookupArtistById - paginates artist releases so older albums receive tracks', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    const releaseGroupId = 'rg-vices-and-virtues'
    const releaseOffsets = []

    setMock(async (path, params) => {
      if (path === '/artist/artist-panic') {
        return {
          id: 'artist-panic',
          name: 'Panic! at the Disco'
        }
      }
      if (path === '/release-group') {
        return {
          'release-groups': [{
            id: releaseGroupId,
            title: 'Vices & Virtues',
            'primary-type': 'Album',
            'first-release-date': '2011-03-18'
          }]
        }
      }
      if (path === '/release') {
        assert.strictEqual(params.artist, 'artist-panic')
        assert.strictEqual(params.limit, 100)
        releaseOffsets.push(params.offset)

        if (params.offset === 0) {
          return {
            count: 101,
            releases: Array.from({ length: 100 }, (_, index) => ({
              id: `rel-filler-${index + 1}`,
              title: `Filler Release ${index + 1}`,
              'release-group': { id: `rg-filler-${index + 1}` },
              media: [{
                title: 'Digital Media',
                format: 'Digital Media',
                position: 1,
                tracks: makeMusicBrainzTracks(1, 'artist-panic')
              }]
            }))
          }
        }

        return {
          count: 101,
          releases: [{
            id: 'rel-vices-and-virtues',
            title: 'Vices & Virtues',
            date: '2011-03-18',
            status: 'Official',
            country: 'US',
            'release-group': { id: releaseGroupId },
            media: [{
              title: 'CD',
              format: 'CD',
              position: 1,
              tracks: makeMusicBrainzTracks(14, 'artist-panic')
            }]
          }]
        }
      }
    })

    const result = await musicbrainzProvider.lookupArtistById('artist-panic')
    const album = result.albums[0]

    assert.deepStrictEqual(releaseOffsets, [0, 100])
    assert.strictEqual(album.id, releaseGroupId)
    assert.strictEqual(album.trackCount, 14)
    assert.strictEqual(album.releases.length, 1)
    assert.strictEqual(album.releases[0].id, 'rel-vices-and-virtues')
    assert.strictEqual(album.releases[0].media[0].format, 'CD')
    assert.strictEqual(album.releases[0].tracks.length, 14)
  })

  await t.test('lookupArtistById - uses release-group fallback when artist releases omit an album', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    const releaseGroupId = 'rg-vices-and-virtues'
    const releaseQueries = []

    setMock(async (path, params) => {
      if (path === '/artist/artist-panic') {
        return {
          id: 'artist-panic',
          name: 'Panic! at the Disco'
        }
      }
      if (path === '/release-group') {
        return {
          'release-groups': [{
            id: releaseGroupId,
            title: 'Vices & Virtues',
            'primary-type': 'Album',
            'first-release-date': '2011-03-18'
          }]
        }
      }
      if (path === '/release') {
        releaseQueries.push(params)

        if (params.artist === 'artist-panic') {
          return {
            count: 1,
            releases: [{
              id: 'rel-unrelated',
              title: 'Unrelated Release',
              'release-group': { id: 'rg-unrelated' },
              media: [{
                title: 'Digital Media',
                format: 'Digital Media',
                position: 1,
                tracks: makeMusicBrainzTracks(1, 'artist-panic')
              }]
            }]
          }
        }

        assert.strictEqual(params['release-group'], releaseGroupId)
        assert.strictEqual(params.inc, 'media+recordings+artist-credits')
        return {
          releases: [{
            id: 'rel-vices-and-virtues',
            title: 'Vices & Virtues',
            date: '2011-03-18',
            status: 'Official',
            country: 'US',
            media: [{
              title: 'CD',
              format: 'CD',
              position: 1,
              tracks: makeMusicBrainzTracks(14, 'artist-panic')
            }]
          }]
        }
      }
    })

    const result = await musicbrainzProvider.lookupArtistById('artist-panic')
    const album = result.albums[0]

    assert.deepStrictEqual(releaseQueries.map(params => params.artist || params['release-group']), ['artist-panic', releaseGroupId])
    assert.strictEqual(album.id, releaseGroupId)
    assert.strictEqual(album.trackCount, 14)
    assert.strictEqual(album.releases.length, 1)
    assert.strictEqual(album.releases[0].id, 'rel-vices-and-virtues')
    assert.strictEqual(album.releases[0].media[0].format, 'CD')
    assert.strictEqual(album.releases[0].tracks.length, 14)
  })

  await t.test('lookupArtistById - falls back to one release lookup when browse release groups lack embedded releases', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    let releaseLookupCount = 0

    setMock(async (path, params) => {
      if (path === '/artist/artist-fallback') {
        return {
          id: 'artist-fallback',
          name: 'Fallback Artist'
        }
      }
      if (path === '/release-group') {
        return {
          'release-groups': [{
            id: 'rg-fallback',
            title: 'Fallback Album',
            'primary-type': 'Album',
            'first-release-date': '2022-08-19'
          }]
        }
      }
      if (path === '/release') {
        releaseLookupCount += 1
        assert.strictEqual(params.artist, 'artist-fallback')
        return {
          releases: [{
            id: 'rel-fallback',
            title: 'Fallback Album',
            date: '2022-08-19',
            'release-group': { id: 'rg-fallback' },
            media: [{
              title: 'CD',
              format: 'CD',
              position: 1,
              tracks: makeMusicBrainzTracks(2, 'artist-fallback')
            }]
          }]
        }
      }
    })

    const result = await musicbrainzProvider.lookupArtistById('artist-fallback')
    const album = result.albums[0]

    assert.strictEqual(releaseLookupCount, 1)
    assert.strictEqual(album.trackCount, 2)
    assert.strictEqual(album.releases.length, 1)
    assert.strictEqual(album.releases[0].id, 'rel-fallback')
    assert.strictEqual(album.releases[0].trackCount, 2)
    assert.deepStrictEqual(album.releases[0].tracks.map(track => track.trackName), ['Track 1', 'Track 2'])
  })

  await t.test('lookupArtistById - preserves album summary and zero-track browse release when lookup has no tracks', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    const releaseGroupId = 'rg-no-tracks'
    const releaseDate = '2022-08-19T00:00:00Z'

    setMock(async (path, params) => {
      if (path === '/artist/artist-no-tracks') {
        return {
          id: 'artist-no-tracks',
          name: 'No Tracks Artist'
        }
      }
      if (path === '/release-group') {
        return {
          'release-groups': [{
            id: releaseGroupId,
            title: 'No Tracks Album',
            'primary-type': 'Album',
            'first-release-date': releaseDate,
            releases: [{
              id: 'rel-no-tracks-browse',
              title: 'No Tracks Album',
              date: releaseDate,
              media: [{
                title: 'Digital Media',
                format: 'Digital Media',
                position: 1
              }]
            }]
          }]
        }
      }
      if (path === '/release') {
        if (params['release-group']) {
          assert.strictEqual(params['release-group'], releaseGroupId)
          return {
            releases: [{
              id: 'rel-no-tracks-release-group-lookup',
              title: 'No Tracks Album',
              date: releaseDate,
              media: [{
                title: 'Digital Media',
                format: 'Digital Media',
                position: 1
              }]
            }]
          }
        }

        assert.strictEqual(params.artist, 'artist-no-tracks')
        return {
          releases: [{
            id: 'rel-no-tracks-lookup',
            title: 'No Tracks Album',
            date: releaseDate,
            'release-group': { id: releaseGroupId },
            media: [{
              title: 'Digital Media',
              format: 'Digital Media',
              position: 1
            }]
          }]
        }
      }
    })

    const result = await musicbrainzProvider.lookupArtistById('artist-no-tracks')
    const album = result.albums[0]
    const expectedCover = `https://coverartarchive.org/release-group/${releaseGroupId}/front`

    assert.strictEqual(album.id, releaseGroupId)
    assert.strictEqual(album.title, 'No Tracks Album')
    assert.strictEqual(album.releaseDate, releaseDate)
    assert.strictEqual(album.imageUrl, expectedCover)
    assert.deepStrictEqual(album.images, [{
      coverType: 'cover',
      url: expectedCover,
      remoteUrl: expectedCover
    }])
    assert.strictEqual(album.remoteCover, expectedCover)
    assert.strictEqual(album.provider, 'musicbrainz')
    assert.strictEqual(album.ids.musicbrainzReleaseGroupId, releaseGroupId)
    assert.strictEqual(album.trackCount, 0)
    assert.strictEqual(album.releases.length, 1)
    assert.strictEqual(album.releases[0].id, 'rel-no-tracks-browse')
    assert.strictEqual(album.releases[0].trackCount, 0)
    assert.deepStrictEqual(album.releases[0].tracks, [])
  })

  await t.test('lookupArtistById - deduplicates duplicate release group ids for release lookup within a request', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    let releaseLookupCount = 0

    setMock(async (path, params) => {
      if (path === '/artist/artist-duplicate-groups') {
        return {
          id: 'artist-duplicate-groups',
          name: 'Duplicate Groups Artist'
        }
      }
      if (path === '/release-group') {
        return {
          'release-groups': [
            {
              id: 'rg-duplicate',
              title: 'Duplicate Album',
              'primary-type': 'Album',
              'first-release-date': '2022-08-19'
            },
            {
              id: 'rg-duplicate',
              title: 'Duplicate Album',
              'primary-type': 'Album',
              'first-release-date': '2022-08-19'
            }
          ]
        }
      }
      if (path === '/release') {
        releaseLookupCount += 1
        assert.strictEqual(params.artist, 'artist-duplicate-groups')
        return {
          releases: [{
            id: 'rel-duplicate',
            title: 'Duplicate Album',
            'release-group': { id: 'rg-duplicate' },
            media: [{
              title: 'Digital Media',
              format: 'Digital Media',
              position: 1,
              tracks: makeMusicBrainzTracks(1, 'artist-duplicate-groups')
            }]
          }]
        }
      }
    })

    const result = await musicbrainzProvider.lookupArtistById('artist-duplicate-groups')

    assert.strictEqual(releaseLookupCount, 1)
    assert.deepStrictEqual(result.albums.map(album => album.ids.musicbrainzReleaseGroupId), ['rg-duplicate', 'rg-duplicate'])
    assert.deepStrictEqual(result.albums.map(album => album.trackCount), [1, 1])
  })

  await t.test('lookupArtistById - deduplicates duplicate release group ids for release-group fallback lookup within a request', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    let releaseGroupLookupCount = 0

    setMock(async (path, params) => {
      if (path === '/artist/artist-duplicate-fallback') {
        return {
          id: 'artist-duplicate-fallback',
          name: 'Duplicate Fallback Artist'
        }
      }
      if (path === '/release-group') {
        return {
          'release-groups': [
            {
              id: 'rg-duplicate-fallback',
              title: 'Duplicate Fallback Album',
              'primary-type': 'Album',
              'first-release-date': '2022-08-19'
            },
            {
              id: 'rg-duplicate-fallback',
              title: 'Duplicate Fallback Album',
              'primary-type': 'Album',
              'first-release-date': '2022-08-19'
            }
          ]
        }
      }
      if (path === '/release') {
        if (params['release-group']) {
          releaseGroupLookupCount += 1
          assert.strictEqual(params['release-group'], 'rg-duplicate-fallback')
          return {
            releases: [{
              id: 'rel-duplicate-fallback',
              title: 'Duplicate Fallback Album',
              'release-group': { id: 'rg-duplicate-fallback' },
              media: [{
                title: 'Digital Media',
                format: 'Digital Media',
                position: 1,
                tracks: makeMusicBrainzTracks(1, 'artist-duplicate-fallback')
              }]
            }]
          }
        }

        assert.strictEqual(params.artist, 'artist-duplicate-fallback')
        return { releases: [] }
      }
    })

    const result = await musicbrainzProvider.lookupArtistById('artist-duplicate-fallback')

    assert.strictEqual(releaseGroupLookupCount, 1)
    assert.deepStrictEqual(result.albums.map(album => album.ids.musicbrainzReleaseGroupId), ['rg-duplicate-fallback', 'rg-duplicate-fallback'])
    assert.deepStrictEqual(result.albums.map(album => album.trackCount), [1, 1])
  })

  await t.test('lookupAlbumById - returns release group metadata for Lidarr album refetch', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    setMock(async (path, params) => {
      if (path === '/release-group/rg1') {
        assert.strictEqual(params.inc, 'artist-credits+ratings')
        return {
          id: 'rg1',
          title: 'OK Computer',
          'first-release-date': '1997-05-21',
          'primary-type': 'Album',
          'secondary-types': [],
          rating: { value: 4.5, 'votes-count': 42 },
          'artist-credit': [{
            artist: {
              id: 'a74b1b7f',
              name: 'Radiohead',
              'sort-name': 'Radiohead'
            }
          }]
        }
      }
      if (path === '/release') {
        assert.strictEqual(params['release-group'], 'rg1')
        assert.strictEqual(params.inc, 'media+recordings+artist-credits')
        return {
          releases: [{
            id: 'rel1',
            title: 'OK Computer',
            date: '1997-05-21',
            status: 'Official',
            country: 'GB',
            media: [{
              title: 'CD 1',
              format: 'CD',
              position: 1,
              tracks: [{
                id: 'track1',
                title: 'Airbag',
                number: '1',
                position: 1,
                length: 284000,
                recording: {
                  id: 'rec1',
                  title: 'Airbag',
                  length: 284000,
                  'artist-credit': [{
                    artist: {
                      id: 'a74b1b7f',
                      name: 'Radiohead'
                    }
                  }]
                }
              }]
            }]
          }]
        }
      }
    })

    const result = await musicbrainzProvider.lookupAlbumById('rg1')
    assert.strictEqual(result.id, 'rg1')
    assert.strictEqual(result.title, 'OK Computer')
    assert.strictEqual(result.artistId, 'a74b1b7f')
    assert.strictEqual(result.artist.artistName, 'Radiohead')
    assert.strictEqual(result.releaseDate, '1997-05-21')
    assert.strictEqual(result.type, 'Album')
    assert.deepStrictEqual(result.rating, { count: 42, value: 4.5 })
    assert.deepStrictEqual(result.ratings, { votes: 42, value: 4.5 })
    assert.deepStrictEqual(result.secondaryTypes, [])
    assert.deepStrictEqual(result.releaseStatuses, ['Official'])
    assert.strictEqual(result.releases.length, 1)
    assert.strictEqual(result.releases[0].tracks.length, 1)
    assert.strictEqual(result.releases[0].tracks[0].artistId, 'a74b1b7f')
  })

  await t.test('lookupAlbumById - includes every credited track artist required by Lidarr MapTrack', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    setMock(async (path, params) => {
      if (path === '/release-group/rg-collab') {
        assert.strictEqual(params.inc, 'artist-credits+ratings')
        return {
          id: 'rg-collab',
          title: 'Collaborative Album',
          'first-release-date': '2024-03-01',
          'primary-type': 'Album',
          'secondary-types': [],
          'artist-credit': [
            {
              artist: {
                id: 'artist-primary',
                name: 'Primary Artist',
                'sort-name': 'Primary Artist'
              }
            },
            {
              artist: {
                id: 'artist-collab',
                name: 'Collaborator',
                'sort-name': 'Collaborator'
              }
            }
          ]
        }
      }
      if (path === '/release') {
        assert.strictEqual(params['release-group'], 'rg-collab')
        assert.strictEqual(params.inc, 'media+recordings+artist-credits')
        return {
          releases: [{
            id: 'rel-collab',
            title: 'Collaborative Album',
            status: 'Official',
            media: [{
              title: 'Digital Media',
              format: 'Digital Media',
              position: 1,
              tracks: [
                {
                  id: 'track-primary',
                  title: 'Opening',
                  number: '1',
                  position: 1,
                  recording: {
                    id: 'rec-primary',
                    title: 'Opening',
                    'artist-credit': [{
                      artist: {
                        id: 'artist-primary',
                        name: 'Primary Artist'
                      }
                    }]
                  }
                },
                {
                  id: 'track-guest',
                  title: 'Feature',
                  number: '2',
                  position: 2,
                  recording: {
                    id: 'rec-guest',
                    title: 'Feature',
                    'artist-credit': [{
                      artist: {
                        id: 'artist-guest',
                        name: 'Guest Artist'
                      }
                    }]
                  }
                }
              ]
            }]
          }]
        }
      }
    })

    const result = await musicbrainzProvider.lookupAlbumById('rg-collab')
    const album = toSkyhookAlbumResource(result)
    const artistIds = new Set(album.artists.map(artist => artist.id))
    const trackArtistIds = album.releases.flatMap(release => release.tracks.map(track => track.artistId))

    // Source of truth:
    // Lidarr SkyHookProxy.GetAlbumInfo builds artistDict from AlbumResource.Artists,
    // then MapTrack dereferences artistDict[TrackResource.ArtistId].
    assert.strictEqual(album.artistId, 'artist-primary')
    assert.deepStrictEqual([...artistIds].sort(), ['artist-collab', 'artist-guest', 'artist-primary'])
    for (const artistId of trackArtistIds) {
      assert.ok(artistIds.has(artistId), `AlbumResource.Artists must include TrackResource.ArtistId ${artistId}`)
    }
  })

  await t.test('lookupAlbumById - maps partial MusicBrainz metadata to Lidarr-safe defaults', async () => {
    const { musicbrainzProvider, setMock } = setupMocks()
    setMock(async (path) => {
      if (path === '/release-group/rg-partial') {
        return {
          id: 'rg-partial',
          title: 'Partial Album',
          'primary-type': 'EP',
          'artist-credit': [{
            artist: {
              id: 'artist-partial',
              name: 'Partial Artist'
            }
          }]
        }
      }
      if (path === '/release') {
        return {
          releases: [{
            id: 'rel-partial',
            title: 'Partial Album',
            media: [{
              position: 1,
              tracks: [{
                title: 'Untitled',
                position: 1,
                recording: {}
              }]
            }]
          }]
        }
      }
    })

    const result = await musicbrainzProvider.lookupAlbumById('rg-partial')
    const album = toSkyhookAlbumResource(result)

    assert.strictEqual(album.id, 'rg-partial')
    assert.strictEqual(album.type, 'EP')
    assert.strictEqual(album.releaseDate, null)
    assert.deepStrictEqual(album.secondaryTypes, [])
    assert.deepStrictEqual(album.releaseStatuses, ['Official'])
    assert.deepStrictEqual(album.rating, { count: 0, value: 0 })
    assert.deepStrictEqual(album.releases[0].country, [])
    assert.deepStrictEqual(album.releases[0].label, [])
    assert.strictEqual(album.releases[0].media[0].format, 'Unknown')
    assert.strictEqual(album.releases[0].tracks[0].artistId, 'artist-partial')
  })
})

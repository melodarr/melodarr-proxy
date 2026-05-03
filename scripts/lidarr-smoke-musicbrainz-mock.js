#!/usr/bin/env node

const http = require('http')

const artistId = process.env.LIDARR_SMOKE_ARTIST_MBID || '2f569e60-0a1b-4fb9-95a4-3dc1525d1aad'
const releaseGroupId = process.env.LIDARR_SMOKE_RELEASE_GROUP_MBID || '920a68fe-7b93-3d0e-bf73-44ac72f03dd2'
const port = Number(process.env.PORT || 0)
const counts = {}

function sendJson (res, statusCode, body) {
  const payload = JSON.stringify(body)
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)

  if (url.pathname === '/__counts') {
    return sendJson(res, 200, counts)
  }

  counts[url.pathname] = (counts[url.pathname] || 0) + 1

  if (url.pathname === `/ws/2/artist/${artistId}`) {
    return sendJson(res, 200, {
      id: artistId,
      name: 'Backstreet Boys',
      'sort-name': 'Backstreet Boys',
      aliases: [
        { name: ' BSB ' },
        { name: 'Back Street Boys' }
      ]
    })
  }

  if (url.pathname === '/ws/2/artist') {
    return sendJson(res, 200, {
      artists: [{
        id: artistId,
        name: 'Backstreet Boys',
        'sort-name': 'Backstreet Boys',
        aliases: [
          { name: ' BSB ' },
          { name: 'Back Street Boys' }
        ]
      }]
    })
  }

  if (url.pathname === '/ws/2/release-group') {
    return sendJson(res, 200, {
      'release-groups': [{
        id: releaseGroupId,
        title: 'Millennium',
        'first-release-date': '1999-05-18',
        'primary-type': 'Album',
        'secondary-types': []
      }]
    })
  }

  if (url.pathname === `/ws/2/release-group/${releaseGroupId}`) {
    return sendJson(res, 200, {
      id: releaseGroupId,
      title: 'Millennium',
      'first-release-date': '1999-05-18',
      'primary-type': 'Album',
      'secondary-types': [],
      'artist-credit': [{
        artist: {
          id: artistId,
          name: 'Backstreet Boys',
          'sort-name': 'Backstreet Boys'
        }
      }]
    })
  }

  if (url.pathname === '/ws/2/release') {
    return sendJson(res, 200, {
      releases: [{
        id: '4b9b7b64-5555-4ec0-9b0f-000000000001',
        title: 'Millennium',
        date: '1999-05-18',
        status: 'Official',
        country: 'US',
        media: [{
          title: 'CD 1',
          format: 'CD',
          position: 1,
          tracks: [{
            id: '4b9b7b64-5555-4ec0-9b0f-000000000002',
            title: 'I Want It That Way',
            number: '1',
            position: 1,
            length: 213000,
            recording: {
              id: '4b9b7b64-5555-4ec0-9b0f-000000000003',
              title: 'I Want It That Way',
              length: 213000,
              'artist-credit': [{
                artist: {
                  id: artistId,
                  name: 'Backstreet Boys',
                  'sort-name': 'Backstreet Boys'
                }
              }]
            }
          }]
        }]
      }]
    })
  }

  return sendJson(res, 404, { error: 'not found', path: url.pathname })
})

server.listen(port, '127.0.0.1', () => {
  const address = server.address()
  process.stdout.write(`MusicBrainz smoke mock listening on ${address.port}\n`)
})

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildImageProxyUrl,
  isTrustedImageUrl,
  proxifyImageUrls
} = require('./imageProxy')

function makeReq () {
  return {
    protocol: 'http',
    get: (name) => {
      if (name === 'x-forwarded-proto') return 'https'
      if (name === 'x-forwarded-host') return 'melodarr-proxy.example.test'
      if (name === 'host') return 'internal:3000'
      return ''
    }
  }
}

test('isTrustedImageUrl only allows HTTPS image provider hosts', () => {
  assert.equal(isTrustedImageUrl('https://coverartarchive.org/release-group/id/front'), true)
  assert.equal(isTrustedImageUrl('https://r2.theaudiodb.com/images/media/artist/thumb/a.jpg'), true)
  assert.equal(isTrustedImageUrl('https://i.discogs.com/a.jpg'), true)
  assert.equal(isTrustedImageUrl('http://coverartarchive.org/release-group/id/front'), false)
  assert.equal(isTrustedImageUrl('https://example.test/a.jpg'), false)
})

test('buildImageProxyUrl uses forwarded public origin', () => {
  assert.equal(
    buildImageProxyUrl('https://coverartarchive.org/release-group/id/front', makeReq()),
    'https://melodarr-proxy.example.test/api/image?url=https%3A%2F%2Fcoverartarchive.org%2Frelease-group%2Fid%2Ffront'
  )
})

test('proxifyImageUrls rewrites image and remote cover fields only', () => {
  const out = proxifyImageUrls({
    links: [{ target: 'https://coverartarchive.org/not-an-image-link', type: 'other' }],
    remoteCover: 'https://coverartarchive.org/release-group/id/front',
    images: [{
      coverType: 'cover',
      url: 'https://r2.theaudiodb.com/images/media/album/thumb/a.jpg',
      remoteUrl: 'https://r2.theaudiodb.com/images/media/album/thumb/a.jpg'
    }]
  }, makeReq())

  assert.equal(out.links[0].target, 'https://coverartarchive.org/not-an-image-link')
  assert.match(out.remoteCover, /^https:\/\/melodarr-proxy\.example\.test\/api\/image\?url=/)
  assert.match(out.images[0].url, /^https:\/\/melodarr-proxy\.example\.test\/api\/image\?url=/)
  assert.match(out.images[0].remoteUrl, /^https:\/\/melodarr-proxy\.example\.test\/api\/image\?url=/)
})

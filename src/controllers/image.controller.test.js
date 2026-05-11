const test = require('node:test')
const assert = require('node:assert/strict')

const { handleImageHead } = require('./image.controller')

function makeResponse () {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    set (name, value) {
      this.headers[name] = value
      return this
    },
    status (statusCode) {
      this.statusCode = statusCode
      return this
    },
    json (body) {
      this.body = body
      return this
    },
    end () {
      this.ended = true
      return this
    }
  }
}

test('image HEAD returns 200 for trusted provider URLs without calling upstream HEAD', () => {
  const req = { query: { url: 'https://r2.theaudiodb.com/images/media/artist/thumb/a.jpg' } }
  const res = makeResponse()

  handleImageHead(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['Content-Type'], 'image/jpeg')
  assert.equal(res.ended, true)
})

test('image HEAD rejects untrusted URLs', () => {
  const req = { query: { url: 'https://example.test/private.jpg' } }
  const res = makeResponse()

  handleImageHead(req, res)

  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error, 'Unsupported image URL')
})

const test = require('node:test')
const assert = require('node:assert')

const requestIdMiddleware = require('./requestId.middleware')
const requestContext = require('../utils/request-context')

function makeReq (headers = {}) {
  return { headers }
}

function makeRes () {
  return {
    headers: {},
    setHeader (k, v) { this.headers[k] = v }
  }
}

test('requestId middleware — generates id when no header', async () => {
  const req = makeReq()
  const res = makeRes()
  await new Promise((resolve) => {
    requestIdMiddleware(req, res, () => {
      assert.ok(req.requestId)
      assert.match(req.requestId, /^[0-9a-f]{16}$/) // 8-byte hex
      assert.strictEqual(res.headers['X-Request-Id'], req.requestId)
      assert.strictEqual(requestContext.getRequestId(), req.requestId)
      resolve()
    })
  })
})

test('requestId middleware — honors valid X-Request-Id header', async () => {
  const req = makeReq({ 'x-request-id': 'lidarr-search-001' })
  const res = makeRes()
  await new Promise((resolve) => {
    requestIdMiddleware(req, res, () => {
      assert.strictEqual(req.requestId, 'lidarr-search-001')
      assert.strictEqual(res.headers['X-Request-Id'], 'lidarr-search-001')
      assert.strictEqual(requestContext.getRequestId(), 'lidarr-search-001')
      resolve()
    })
  })
})

test('requestId middleware — accepts hex, UUID, base64url alphabets', async () => {
  for (const id of [
    'abcdef0123456789',
    '550e8400-e29b-41d4-a716-446655440000',
    'aGVsbG8td29ybGRfMTIz' // base64url style
  ]) {
    const req = makeReq({ 'x-request-id': id })
    const res = makeRes()
    await new Promise((resolve) => {
      requestIdMiddleware(req, res, () => {
        assert.strictEqual(req.requestId, id, `should preserve ${id}`)
        resolve()
      })
    })
  }
})

test('requestId middleware — rejects invalid characters → generates new', async () => {
  const req = makeReq({ 'x-request-id': 'bad id with spaces' })
  const res = makeRes()
  await new Promise((resolve) => {
    requestIdMiddleware(req, res, () => {
      assert.notStrictEqual(req.requestId, 'bad id with spaces')
      assert.match(req.requestId, /^[0-9a-f]{16}$/)
      resolve()
    })
  })
})

test('requestId middleware — rejects too-long values → generates new', async () => {
  const tooLong = 'a'.repeat(65)
  const req = makeReq({ 'x-request-id': tooLong })
  const res = makeRes()
  await new Promise((resolve) => {
    requestIdMiddleware(req, res, () => {
      assert.notStrictEqual(req.requestId, tooLong)
      assert.match(req.requestId, /^[0-9a-f]{16}$/)
      resolve()
    })
  })
})

test('requestId middleware — rejects empty string → generates new', async () => {
  const req = makeReq({ 'x-request-id': '' })
  const res = makeRes()
  await new Promise((resolve) => {
    requestIdMiddleware(req, res, () => {
      assert.match(req.requestId, /^[0-9a-f]{16}$/)
      resolve()
    })
  })
})

test('requestId middleware — async work inside next() inherits ALS context', async () => {
  const req = makeReq({ 'x-request-id': 'async-test-id' })
  const res = makeRes()
  await new Promise((resolve) => {
    requestIdMiddleware(req, res, async () => {
      assert.strictEqual(requestContext.getRequestId(), 'async-test-id')
      await new Promise((resolve) => setTimeout(resolve, 1))
      assert.strictEqual(requestContext.getRequestId(), 'async-test-id')
      await Promise.resolve()
      assert.strictEqual(requestContext.getRequestId(), 'async-test-id')
      resolve()
    })
  })
})

test('validateOrGenerate — exposed for direct testing', () => {
  const fn = requestIdMiddleware.validateOrGenerate
  assert.strictEqual(fn('abc123'), 'abc123')
  assert.match(fn(undefined), /^[0-9a-f]{16}$/)
  assert.match(fn(null), /^[0-9a-f]{16}$/)
  assert.match(fn(''), /^[0-9a-f]{16}$/)
  assert.match(fn('has space'), /^[0-9a-f]{16}$/)
  assert.match(fn('a'.repeat(65)), /^[0-9a-f]{16}$/)
})

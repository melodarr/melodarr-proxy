const test = require('node:test')
const assert = require('node:assert')

const requestContext = require('./request-context')

test('request-context — getRequestId returns null outside any scope', () => {
  assert.strictEqual(requestContext.getRequestId(), null)
})

test('request-context — getRequestId reads inside run() scope', () => {
  const captured = requestContext.run({ requestId: 'abc123' }, () => {
    return requestContext.getRequestId()
  })
  assert.strictEqual(captured, 'abc123')
})

test('request-context — propagates across awaits', async () => {
  await requestContext.run({ requestId: 'across-await' }, async () => {
    assert.strictEqual(requestContext.getRequestId(), 'across-await')
    await Promise.resolve()
    assert.strictEqual(requestContext.getRequestId(), 'across-await')
    await new Promise((resolve) => setImmediate(resolve))
    assert.strictEqual(requestContext.getRequestId(), 'across-await')
    await new Promise((resolve) => setTimeout(resolve, 1))
    assert.strictEqual(requestContext.getRequestId(), 'across-await')
  })
})

test('request-context — sibling scopes are isolated', async () => {
  const seen = []
  await Promise.all([
    requestContext.run({ requestId: 'A' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      seen.push(requestContext.getRequestId())
    }),
    requestContext.run({ requestId: 'B' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      seen.push(requestContext.getRequestId())
    })
  ])
  // Order may vary by timer fire order, but each sees its own id.
  assert.ok(seen.includes('A'))
  assert.ok(seen.includes('B'))
})

test('request-context — leaks nothing after run() returns', () => {
  requestContext.run({ requestId: 'temp' }, () => {
    assert.strictEqual(requestContext.getRequestId(), 'temp')
  })
  assert.strictEqual(requestContext.getRequestId(), null)
})

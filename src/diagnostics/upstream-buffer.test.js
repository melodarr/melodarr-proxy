const test = require('node:test')
const assert = require('node:assert')

const buffer = require('./upstream-buffer')

function makeEntry (overrides = {}) {
  return {
    ts: new Date().toISOString(),
    requestId: 'req-' + Math.random().toString(36).slice(2, 10),
    provider: 'musicbrainz',
    path: '/artist',
    attempt: 1,
    selectedAddress: '142.132.241.153',
    selectedFamily: 4,
    failedStep: null,
    error: null,
    httpStatus: 200,
    durationMs: 50,
    ...overrides
  }
}

test('upstream-buffer.record + query', async (t) => {
  t.beforeEach(() => buffer.clear())

  await t.test('records entries and returns them newest-first', () => {
    buffer.record(makeEntry({ attempt: 1 }))
    buffer.record(makeEntry({ attempt: 2 }))
    buffer.record(makeEntry({ attempt: 3 }))
    const result = buffer.query()
    assert.strictEqual(result.entries.length, 3)
    assert.strictEqual(result.entries[0].attempt, 3) // newest first
    assert.strictEqual(result.entries[2].attempt, 1)
    assert.strictEqual(result.totalCount, 3)
    assert.strictEqual(result.filteredCount, 3)
  })

  await t.test('evicts oldest when exceeding maxSize', () => {
    buffer.setMaxSize(3)
    buffer.record(makeEntry({ attempt: 1 }))
    buffer.record(makeEntry({ attempt: 2 }))
    buffer.record(makeEntry({ attempt: 3 }))
    buffer.record(makeEntry({ attempt: 4 }))
    const result = buffer.query()
    assert.strictEqual(result.entries.length, 3)
    assert.strictEqual(result.entries[0].attempt, 4)
    assert.strictEqual(result.entries[2].attempt, 2)
    assert.strictEqual(result.maxSize, 3)
    buffer.setMaxSize(buffer.MAX_DEFAULT)
  })

  await t.test('filters by provider', () => {
    buffer.record(makeEntry({ provider: 'musicbrainz' }))
    buffer.record(makeEntry({ provider: 'discogs' }))
    buffer.record(makeEntry({ provider: 'musicbrainz' }))
    const result = buffer.query({ provider: 'musicbrainz' })
    assert.strictEqual(result.entries.length, 2)
    assert.strictEqual(result.filteredCount, 2)
    assert.strictEqual(result.totalCount, 3)
    assert.ok(result.entries.every((e) => e.provider === 'musicbrainz'))
  })

  await t.test('provider filter is case-insensitive', () => {
    buffer.record(makeEntry({ provider: 'musicbrainz' }))
    const result = buffer.query({ provider: 'MusicBrainz' })
    assert.strictEqual(result.entries.length, 1)
  })

  await t.test('respects limit', () => {
    for (let i = 1; i <= 10; i++) buffer.record(makeEntry({ attempt: i }))
    const result = buffer.query({ limit: 3 })
    assert.strictEqual(result.entries.length, 3)
    assert.strictEqual(result.entries[0].attempt, 10)
    assert.strictEqual(result.entries[2].attempt, 8)
    assert.strictEqual(result.filteredCount, 10)
  })

  await t.test('limit + provider together', () => {
    for (let i = 1; i <= 5; i++) buffer.record(makeEntry({ provider: 'musicbrainz', attempt: i }))
    for (let i = 1; i <= 5; i++) buffer.record(makeEntry({ provider: 'discogs', attempt: i }))
    const result = buffer.query({ provider: 'musicbrainz', limit: 2 })
    assert.strictEqual(result.entries.length, 2)
    assert.ok(result.entries.every((e) => e.provider === 'musicbrainz'))
    assert.strictEqual(result.filteredCount, 5)
  })

  await t.test('filters by requestId across providers', () => {
    buffer.record(makeEntry({ provider: 'musicbrainz', requestId: 'req-A', attempt: 1 }))
    buffer.record(makeEntry({ provider: 'musicbrainz', requestId: 'req-A', attempt: 2 }))
    buffer.record(makeEntry({ provider: 'discogs', requestId: 'req-A', attempt: 1 }))
    buffer.record(makeEntry({ provider: 'musicbrainz', requestId: 'req-B', attempt: 1 }))
    const result = buffer.query({ requestId: 'req-A' })
    assert.strictEqual(result.entries.length, 3)
    assert.ok(result.entries.every((e) => e.requestId === 'req-A'))
    // Should pull across providers (mb + discogs both included for req-A).
    const providers = new Set(result.entries.map((e) => e.provider))
    assert.ok(providers.has('musicbrainz'))
    assert.ok(providers.has('discogs'))
  })

  await t.test('requestId + provider intersect', () => {
    buffer.record(makeEntry({ provider: 'musicbrainz', requestId: 'req-X', attempt: 1 }))
    buffer.record(makeEntry({ provider: 'discogs', requestId: 'req-X', attempt: 1 }))
    const result = buffer.query({ provider: 'musicbrainz', requestId: 'req-X' })
    assert.strictEqual(result.entries.length, 1)
    assert.strictEqual(result.entries[0].provider, 'musicbrainz')
  })
})

test('upstream-buffer.classifyFailedStep', async (t) => {
  await t.test('null when no error and 2xx status', () => {
    assert.strictEqual(buffer.classifyFailedStep({ status: 200 }), null)
    assert.strictEqual(buffer.classifyFailedStep({ status: 204 }), null)
  })

  await t.test('http for non-2xx without error', () => {
    assert.strictEqual(buffer.classifyFailedStep({ status: 503 }), 'http')
    assert.strictEqual(buffer.classifyFailedStep({ status: 429 }), 'http')
    assert.strictEqual(buffer.classifyFailedStep({ status: 404 }), 'http')
  })

  await t.test('dns for DNS error codes', () => {
    assert.strictEqual(buffer.classifyFailedStep({ error: { code: 'ENOTFOUND' } }), 'dns')
    assert.strictEqual(buffer.classifyFailedStep({ error: { code: 'EAI_AGAIN' } }), 'dns')
    assert.strictEqual(buffer.classifyFailedStep({ error: { code: 'EAI_NODATA' } }), 'dns')
  })

  await t.test('tcp for TCP connect error codes', () => {
    assert.strictEqual(buffer.classifyFailedStep({ error: { code: 'ECONNREFUSED' } }), 'tcp')
    assert.strictEqual(buffer.classifyFailedStep({ error: { code: 'EHOSTUNREACH' } }), 'tcp')
    assert.strictEqual(buffer.classifyFailedStep({ error: { code: 'ENETUNREACH' } }), 'tcp')
  })

  await t.test('tls for ECONNRESET (the MB failure mode)', () => {
    assert.strictEqual(buffer.classifyFailedStep({ error: { code: 'ECONNRESET' } }), 'tls')
    assert.strictEqual(buffer.classifyFailedStep({ error: { code: 'EPROTO' } }), 'tls')
    assert.strictEqual(buffer.classifyFailedStep({ error: { code: 'ERR_SSL_PROTOCOL_ERROR' } }), 'tls')
  })

  await t.test('http for axios timeout (phase ambiguous)', () => {
    assert.strictEqual(buffer.classifyFailedStep({ error: { code: 'ECONNABORTED' } }), 'http')
    assert.strictEqual(buffer.classifyFailedStep({ error: { code: 'ETIMEDOUT' } }), 'http')
  })

  await t.test('http for HTTP-status errors with response', () => {
    assert.strictEqual(buffer.classifyFailedStep({ error: { code: null }, status: 500 }), 'http')
  })

  await t.test('http for unknown error codes', () => {
    assert.strictEqual(buffer.classifyFailedStep({ error: { code: 'UNKNOWN_THING' } }), 'http')
  })
})

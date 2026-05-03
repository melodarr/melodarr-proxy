const test = require('node:test')
const assert = require('node:assert')

function loadServiceWithMocks ({ resolve4, resolve6, settings = {} } = {}) {
  delete require.cache[require.resolve('./diagnose.service')]

  require.cache[require.resolve('../settings/store')] = {
    exports: {
      getConfigValue: (key) => {
        const defaults = {
          musicbrainzBaseUrl: 'https://musicbrainz.example/ws/2',
          musicbrainzIpFamily: 'auto',
          musicbrainzApiKey: '',
          upstreamTimeoutMs: 5000,
          appName: 'melodarr-proxy',
          appVersion: 'test',
          appContact: 'test@example.com'
        }
        return key in settings ? settings[key] : defaults[key]
      }
    }
  }

  // Mock dns.promises by replacing the resolved module before service loads.
  require.cache[require.resolve('dns')] = {
    exports: {
      promises: {
        resolve4: resolve4 || (async () => { const e = new Error('no v4'); e.code = 'ENODATA'; throw e }),
        resolve6: resolve6 || (async () => { const e = new Error('no v6'); e.code = 'ENODATA'; throw e })
      }
    }
  }

  return require('./diagnose.service')
}

test('diagnose.service helpers', async (t) => {
  const svc = loadServiceWithMocks()

  await t.test('classifyFailedStep — dns when lookup never fired', () => {
    const r = { phaseAt: { lookup: 0, connect: 0, secure: 0, end: 0 } }
    assert.strictEqual(svc.classifyFailedStep(r), 'dns')
  })

  await t.test('classifyFailedStep — dns when lookupError set even if lookup time recorded', () => {
    const r = {
      phaseAt: { lookup: 100, connect: 0, secure: 0, end: 0 },
      lookupError: new Error('ENOTFOUND')
    }
    assert.strictEqual(svc.classifyFailedStep(r), 'dns')
  })

  await t.test('classifyFailedStep — tcp when lookup ok but no connect', () => {
    const r = { phaseAt: { lookup: 100, connect: 0, secure: 0, end: 0 } }
    assert.strictEqual(svc.classifyFailedStep(r), 'tcp')
  })

  await t.test('classifyFailedStep — tls when connect ok but no secureConnect', () => {
    const r = { phaseAt: { lookup: 100, connect: 110, secure: 0, end: 0 } }
    assert.strictEqual(svc.classifyFailedStep(r), 'tls')
  })

  await t.test('classifyFailedStep — http on non-2xx response', () => {
    const r = {
      phaseAt: { lookup: 100, connect: 110, secure: 150, response: 200, end: 220 },
      status: 'http_complete',
      httpStatus: 503
    }
    assert.strictEqual(svc.classifyFailedStep(r), 'http')
  })

  await t.test('classifyFailedStep — parse on 2xx with parse error', () => {
    const r = {
      phaseAt: { lookup: 100, connect: 110, secure: 150, response: 200, end: 220 },
      status: 'http_complete',
      httpStatus: 200,
      parseError: 'Unexpected token'
    }
    assert.strictEqual(svc.classifyFailedStep(r), 'parse')
  })

  await t.test('classifyFailedStep — null on 2xx with valid parse', () => {
    const r = {
      phaseAt: { lookup: 100, connect: 110, secure: 150, response: 200, end: 220 },
      status: 'http_complete',
      httpStatus: 200
    }
    assert.strictEqual(svc.classifyFailedStep(r), null)
  })

  await t.test('timings — computes per-phase deltas relative to previous phase', () => {
    const t1 = svc.timings({ start: 1000, lookup: 1010, connect: 1030, secure: 1100, response: 1200, end: 1250 })
    assert.deepStrictEqual(t1, { dns: 10, tcp: 20, tls: 70, http: 150, total: 250 })
  })

  await t.test('timings — null phases when not reached', () => {
    const t1 = svc.timings({ start: 1000, lookup: 1010, connect: 0, secure: 0, response: 0, end: 0 })
    assert.strictEqual(t1.dns, 10)
    assert.strictEqual(t1.tcp, null)
    assert.strictEqual(t1.tls, null)
    assert.strictEqual(t1.http, null)
  })

  await t.test('pickHeaders — returns only allow-listed names, lower-cased, present-only', () => {
    const out = svc.pickHeaders(
      { 'retry-after': '120', 'x-ratelimit-remaining': '0', authorization: 'secret' },
      svc.RATE_LIMIT_HEADER_NAMES
    )
    assert.deepStrictEqual(out, { 'retry-after': '120', 'x-ratelimit-remaining': '0' })
    assert.strictEqual(out.authorization, undefined)
  })

  await t.test('errorDetails — preserves low-level socket fields', () => {
    const err = new Error('connect ENETUNREACH 2a01:4f8:c011:f68::1:443')
    err.code = 'ENETUNREACH'
    err.errno = -51
    err.syscall = 'connect'
    err.address = '2a01:4f8:c011:f68::1'
    err.port = 443

    const out = svc.errorDetails(err)
    assert.strictEqual(out.code, 'ENETUNREACH')
    assert.strictEqual(out.syscall, 'connect')
    assert.strictEqual(out.address, '2a01:4f8:c011:f68::1')
    assert.strictEqual(out.port, 443)
  })

  await t.test('summarizeFailure — explains TLS handshake failures', () => {
    const out = svc.summarizeFailure({
      failedStep: 'tls',
      error: { code: 'ECONNRESET' },
      selectedFamily: 4,
      configuredFamily: 'auto'
    })

    assert.match(out.summary, /TLS/)
    assert.match(out.likelyCause, /handshake/)
    assert.ok(out.recommendations.some((item) => item.includes('IPv4 and IPv6')))
  })
})

test('diagnoseMusicBrainz — DNS failure path returns failedStep dns and no http section', async () => {
  const svc = loadServiceWithMocks({
    resolve4: async () => { const e = new Error('not found'); e.code = 'ENOTFOUND'; throw e },
    resolve6: async () => { const e = new Error('not found'); e.code = 'ENOTFOUND'; throw e }
  })

  const result = await svc.diagnoseMusicBrainz()
  assert.strictEqual(result.provider, 'musicbrainz')
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.failedStep, 'dns')
  assert.strictEqual(result.error.code, 'ENOTFOUND')
  assert.match(result.diagnosis.summary, /DNS/)
  assert.deepStrictEqual(result.dns.addresses, [])
  assert.strictEqual(result.dns.errors.v4, 'ENOTFOUND')
  assert.strictEqual(result.dns.errors.v6, 'ENOTFOUND')
  assert.strictEqual(result.http, undefined)
  assert.strictEqual(typeof result.timingsMs.total, 'number')
})

test('diagnoseMusicBrainz — surfaces partial DNS (v4 ok, v6 fails)', async () => {
  // With a non-routable RFC5737 test address, the eventual TCP connect will
  // fail/time out — we just need the DNS block to reflect both records.
  const svc = loadServiceWithMocks({
    resolve4: async () => ['192.0.2.1'],
    resolve6: async () => { const e = new Error('no AAAA'); e.code = 'ENODATA'; throw e },
    settings: {
      musicbrainzBaseUrl: 'https://192.0.2.1', // forces literal-IP path so we don't depend on real DNS in CI
      upstreamTimeoutMs: 100
    }
  })

  const result = await svc.diagnoseMusicBrainz()
  // Hostname is a literal IP, so v4 resolution returned the IP and v6 errored.
  assert.strictEqual(Array.isArray(result.dns.addresses), true)
  assert.strictEqual(Array.isArray(result.probes), true)
  assert.ok(result.probes.some((probe) => probe.label === '4'))
  assert.ok(result.probes.some((probe) => probe.label === '6'))
  assert.ok(result.dns.addresses.some((a) => a.address === '192.0.2.1' && a.family === 4))
  assert.strictEqual(result.dns.errors.v6, 'ENODATA')
  // We expect the request itself to fail (timeout / unreachable) — failedStep
  // should be tcp or tls, not dns, since we *did* resolve an address.
  assert.strictEqual(result.ok, false)
  assert.notStrictEqual(result.failedStep, 'dns')
})

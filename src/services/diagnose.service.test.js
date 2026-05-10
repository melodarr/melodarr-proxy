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
      selectedFamily: 6,
      configuredFamily: '6'
    })

    assert.match(out.summary, /TLS/)
    assert.match(out.likelyCause, /handshake/)
    assert.ok(out.recommendations.some((item) => item.includes('curl -6')))
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

test('diagnoseMusicBrainz — treats missing AAAA as DNS failure and never probes IPv4', async () => {
  const svc = loadServiceWithMocks({
    resolve4: async () => ['192.0.2.1'],
    resolve6: async () => { const e = new Error('no AAAA'); e.code = 'ENODATA'; throw e },
    settings: {
      musicbrainzBaseUrl: 'https://musicbrainz.example/ws/2',
      upstreamTimeoutMs: 100
    }
  })

  const result = await svc.diagnoseMusicBrainz()
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.failedStep, 'dns')
  assert.strictEqual(result.target.policy, 'ipv6_only')
  assert.strictEqual(result.target.fallbackAllowed, false)
  assert.ok(result.dns.addresses.some((a) => a.address === '192.0.2.1' && a.family === 4))
  assert.strictEqual(result.dns.errors.v6, 'ENODATA')
  assert.deepStrictEqual(result.probes, [])
  assert.match(result.error.message, /No AAAA/)
})

test('diagnoseMusicBrainz — reports invalid MusicBrainz contact without leaking contact value', async () => {
  const svc = loadServiceWithMocks({
    resolve4: async () => ['192.0.2.1'],
    resolve6: async () => { const e = new Error('no AAAA'); e.code = 'ENODATA'; throw e },
    settings: {
      musicbrainzBaseUrl: 'https://musicbrainz.example/ws/2',
      upstreamTimeoutMs: 100,
      appContact: 'admin@example.com'
    }
  })

  const result = await svc.diagnoseMusicBrainz()
  assert.strictEqual(result.userAgent.valid, false)
  assert.strictEqual(result.userAgent.code, 'PLACEHOLDER_CONTACT')
  assert.match(result.userAgent.recommendation, /APP_CONTACT/)
  assert.ok(result.diagnosis.recommendations.some((item) => item.includes('APP_CONTACT')))
  assert.ok(!JSON.stringify(result.userAgent).includes('admin@example.com'))
})

test('diagnoseGenericProvider — unsupported providers return contract-safe error', async () => {
  const svc = loadServiceWithMocks()

  const result = await svc.diagnoseGenericProvider('unknown')
  assert.strictEqual(result.provider, 'unknown')
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.failedStep, 'unsupported')
  assert.strictEqual(result.error.code, 'UNSUPPORTED_PROVIDER')
})

test('diagnoseGenericProvider — DNS failure path includes generic provider policy', async () => {
  const svc = loadServiceWithMocks({
    resolve4: async () => { const e = new Error('not found'); e.code = 'ENOTFOUND'; throw e },
    resolve6: async () => { const e = new Error('not found'); e.code = 'ENOTFOUND'; throw e }
  })

  const result = await svc.diagnoseGenericProvider('itunes')
  assert.strictEqual(result.provider, 'itunes')
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.failedStep, 'dns')
  assert.strictEqual(result.target.policy, 'auto')
  assert.strictEqual(result.target.fallbackAllowed, true)
  assert.strictEqual(result.target.configuredIpFamily, 'auto')
  assert.strictEqual(result.error.code, 'ENOTFOUND')
  assert.match(result.diagnosis.summary, /DNS/)
})

test('diagnoseGenericProvider — uses runtime provider IP family policy', async () => {
  const svc = loadServiceWithMocks({
    resolve4: async () => { const e = new Error('not found'); e.code = 'ENOTFOUND'; throw e },
    resolve6: async () => { const e = new Error('not found'); e.code = 'ENOTFOUND'; throw e },
    settings: {
      itunesIpFamily: '4',
      providerIpFamily: '6'
    }
  })

  const result = await svc.diagnoseGenericProvider('itunes')
  assert.strictEqual(result.provider, 'itunes')
  assert.strictEqual(result.target.configuredIpFamily, '4')
  assert.strictEqual(result.dns.configuredFamily, '4')
})

test('redactUrl — strips secret-bearing query params', () => {
  const svc = loadServiceWithMocks()
  const redacted = svc.redactUrl('https://example.com/x?api_key=SECRET&q=hello&token=abc&other=keep')
  const u = new URL(redacted)
  assert.strictEqual(u.searchParams.get('api_key'), 'REDACTED')
  assert.strictEqual(u.searchParams.get('token'), 'REDACTED')
  assert.strictEqual(u.searchParams.get('q'), 'hello')
  assert.strictEqual(u.searchParams.get('other'), 'keep')
})

test('redactUrl — passes through URLs without secrets unchanged', () => {
  const svc = loadServiceWithMocks()
  const input = 'https://example.com/x?q=hello'
  assert.strictEqual(svc.redactUrl(input), 'https://example.com/x?q=hello')
})

test('diagnoseGenericProvider — lastfm without api key returns NOT_CONFIGURED and skips upstream', async () => {
  let dnsCalls = 0
  const svc = loadServiceWithMocks({
    resolve4: async () => { dnsCalls += 1; return [] },
    resolve6: async () => { dnsCalls += 1; return [] },
    settings: { lastfmApiKey: '' }
  })

  const result = await svc.diagnoseGenericProvider('lastfm')

  assert.strictEqual(result.provider, 'lastfm')
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.failedStep, 'not_configured')
  assert.strictEqual(result.error.code, 'NOT_CONFIGURED')
  assert.match(result.error.message, /API key not configured/i)
  assert.deepStrictEqual(result.probes, [])
  assert.strictEqual(dnsCalls, 0, 'no DNS resolution should be attempted')
  // The static-fallback URL surfaced in target.url must not contain a key
  assert.ok(!result.target.url.includes('api_key='))
})

test('diagnoseGenericProvider — lastfm with key configured: probe URL embeds key, target.url redacts it', async () => {
  let probedUrl = null
  const svc = loadServiceWithMocks({
    // Force a DNS failure so we exit before performRequest, but AFTER the URL is
    // built and target is populated — that's where redaction must apply.
    resolve4: async () => { const e = new Error('blocked'); e.code = 'ENOTFOUND'; throw e },
    resolve6: async () => { const e = new Error('blocked'); e.code = 'ENOTFOUND'; throw e },
    settings: { lastfmApiKey: 'SUPER-SECRET-KEY' }
  })

  // Sanity: ensure the registry's buildUrl produces a URL containing the key
  // (this is the URL that would be sent if DNS resolved).
  const { getProviderTransport } = require('../infrastructure/network/provider-registry')
  const transport = getProviderTransport('lastfm')
  probedUrl = transport.buildUrl((k) => (k === 'lastfmApiKey' ? 'SUPER-SECRET-KEY' : ''))
  assert.strictEqual(probedUrl.searchParams.get('api_key'), 'SUPER-SECRET-KEY',
    'outgoing probe URL must include the configured api_key')

  const result = await svc.diagnoseGenericProvider('lastfm')

  assert.strictEqual(result.provider, 'lastfm')
  assert.strictEqual(result.failedStep, 'dns')
  // target.url is what gets returned to clients — must NOT leak the key
  assert.ok(!result.target.url.includes('SUPER-SECRET-KEY'),
    `target.url must not leak the configured api_key, got: ${result.target.url}`)
  assert.match(result.target.url, /api_key=REDACTED/)
})

test('diagnoseGenericProvider — discogs probes anonymously when token missing (requiresAuth=false)', async () => {
  let dnsCalls = 0
  const svc = loadServiceWithMocks({
    resolve4: async () => { dnsCalls += 1; const e = new Error('blocked'); e.code = 'ENOTFOUND'; throw e },
    resolve6: async () => { dnsCalls += 1; const e = new Error('blocked'); e.code = 'ENOTFOUND'; throw e },
    settings: { discogsToken: '' }
  })

  const result = await svc.diagnoseGenericProvider('discogs')

  // Discogs is requiresAuth: false, so we DO probe (and fail at DNS due to mocks)
  assert.strictEqual(result.provider, 'discogs')
  assert.strictEqual(result.failedStep, 'dns')
  assert.notStrictEqual(result.error.code, 'NOT_CONFIGURED')
  assert.ok(dnsCalls > 0, 'DNS resolution should be attempted for anonymous-capable providers')
})

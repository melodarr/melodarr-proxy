const test = require('node:test')
const assert = require('node:assert')

const {
  MUSICBRAINZ_STATES,
  GENERIC_PROVIDER_STATES,
  classifyMusicBrainzReport,
  classifyGenericProviderReport,
  buildMusicBrainzNetworkState,
  buildGenericProviderNetworkState,
  buildMusicBrainzSummary,
  buildGenericProviderSummary
} = require('./network-state')

test('classifyMusicBrainzReport maps successful IPv6 report to healthy', () => {
  assert.strictEqual(
    classifyMusicBrainzReport({ ok: true }),
    MUSICBRAINZ_STATES.HEALTHY
  )
})

test('classifyMusicBrainzReport maps DNS failure to IPv6 DNS failed', () => {
  assert.strictEqual(
    classifyMusicBrainzReport({ ok: false, failedStep: 'dns', error: { code: 'ENODATA' } }),
    MUSICBRAINZ_STATES.DNS_FAILED
  )
})

test('classifyMusicBrainzReport maps IPv6 route errors distinctly', () => {
  assert.strictEqual(
    classifyMusicBrainzReport({ ok: false, failedStep: 'tcp', error: { code: 'ENETUNREACH' } }),
    MUSICBRAINZ_STATES.NO_ROUTE
  )
})

test('classifyMusicBrainzReport maps TLS resets distinctly', () => {
  assert.strictEqual(
    classifyMusicBrainzReport({ ok: false, failedStep: 'tls', error: { code: 'ECONNRESET' } }),
    MUSICBRAINZ_STATES.TLS_FAILED
  )
})

test('buildMusicBrainzNetworkState locks policy to IPv6-only with no fallback', () => {
  const state = buildMusicBrainzNetworkState({
    ok: false,
    failedStep: 'tcp',
    checkedAt: '2026-05-07T16:00:00Z',
    error: { code: 'ENETUNREACH' },
    dns: {
      addresses: [{ address: '2a01:4f8:c011:f68::1', family: 6 }],
      errors: {}
    }
  }, 2, null)

  assert.strictEqual(state.provider, 'musicbrainz')
  assert.strictEqual(state.policy, 'ipv6_only')
  assert.strictEqual(state.family, 6)
  assert.strictEqual(state.fallbackAllowed, false)
  assert.strictEqual(state.state, MUSICBRAINZ_STATES.NO_ROUTE)
  assert.strictEqual(state.consecutiveFailures, 2)
  assert.strictEqual(state.dns.aaaaAvailable, true)
  assert.ok(state.recommendations.some((item) => item.includes('IPv6')))
})

test('buildMusicBrainzSummary returns compact health-safe shape', () => {
  const summary = buildMusicBrainzSummary({
    state: MUSICBRAINZ_STATES.HEALTHY,
    ok: true,
    checkedAt: '2026-05-07T16:00:00Z',
    lastSuccessAt: '2026-05-07T16:00:00Z',
    consecutiveFailures: 0
  })

  assert.deepStrictEqual(summary, {
    policy: 'ipv6_only',
    family: 6,
    fallbackAllowed: false,
    state: MUSICBRAINZ_STATES.HEALTHY,
    ok: true,
    failedStep: null,
    userAgentValid: null,
    lastCheckedAt: '2026-05-07T16:00:00Z',
    lastSuccessAt: '2026-05-07T16:00:00Z',
    consecutiveFailures: 0
  })
})

test('buildMusicBrainzNetworkState carries invalid User-Agent contact diagnostics', () => {
  const state = buildMusicBrainzNetworkState({
    ok: false,
    failedStep: 'http',
    userAgent: {
      valid: false,
      contactType: 'email',
      code: 'PLACEHOLDER_CONTACT',
      message: 'APP_CONTACT must be real.',
      recommendation: 'Set APP_CONTACT to a real email address or contact URL before relying on MusicBrainz.'
    }
  }, 1, null)

  assert.strictEqual(state.userAgent.valid, false)
  assert.ok(state.recommendations.some((item) => item.includes('APP_CONTACT')))
  assert.strictEqual(buildMusicBrainzSummary(state).userAgentValid, false)
})

test('classifyGenericProviderReport maps provider transport failures', () => {
  assert.strictEqual(classifyGenericProviderReport({ ok: true }), GENERIC_PROVIDER_STATES.HEALTHY)
  assert.strictEqual(classifyGenericProviderReport({ ok: false, failedStep: 'dns' }), GENERIC_PROVIDER_STATES.DNS_FAILED)
  assert.strictEqual(classifyGenericProviderReport({ ok: false, failedStep: 'tcp' }), GENERIC_PROVIDER_STATES.TCP_FAILED)
  assert.strictEqual(classifyGenericProviderReport({ ok: false, failedStep: 'tls' }), GENERIC_PROVIDER_STATES.TLS_FAILED)
  assert.strictEqual(classifyGenericProviderReport({ ok: false, failedStep: 'http' }), GENERIC_PROVIDER_STATES.HTTP_FAILED)
})

test('buildGenericProviderNetworkState keeps adaptive providers on auto policy with fallback', () => {
  const state = buildGenericProviderNetworkState({
    provider: 'itunes',
    ok: false,
    failedStep: 'http',
    checkedAt: '2026-05-07T16:00:00Z',
    error: { code: 'HTTP_403' },
    dns: {
      addresses: [
        { address: '17.253.144.10', family: 4 },
        { address: '2620:149:a44::10', family: 6 }
      ],
      errors: {}
    }
  }, {
    provider: 'itunes',
    label: 'Apple Music',
    policy: 'auto',
    requiredFamily: 'auto',
    fallbackAllowed: true
  }, 3, '2026-05-07T15:00:00Z')

  assert.strictEqual(state.provider, 'itunes')
  assert.strictEqual(state.label, 'Apple Music')
  assert.strictEqual(state.policy, 'auto')
  assert.strictEqual(state.family, 'auto')
  assert.strictEqual(state.fallbackAllowed, true)
  assert.strictEqual(state.state, GENERIC_PROVIDER_STATES.HTTP_FAILED)
  assert.strictEqual(state.consecutiveFailures, 3)
  assert.strictEqual(state.lastSuccessAt, '2026-05-07T15:00:00Z')
  assert.strictEqual(state.dns.aAvailable, true)
  assert.strictEqual(state.dns.aaaaAvailable, true)
  assert.ok(state.recommendations.some((item) => item.includes('HTTP')))
})

test('buildGenericProviderSummary returns compact health-safe shape', () => {
  const summary = buildGenericProviderSummary({
    policy: 'auto',
    family: 'auto',
    fallbackAllowed: true,
    state: GENERIC_PROVIDER_STATES.HEALTHY,
    ok: true,
    checkedAt: '2026-05-07T16:00:00Z',
    lastSuccessAt: '2026-05-07T16:00:00Z',
    consecutiveFailures: 0
  })

  assert.deepStrictEqual(summary, {
    policy: 'auto',
    family: 'auto',
    fallbackAllowed: true,
    state: GENERIC_PROVIDER_STATES.HEALTHY,
    ok: true,
    failedStep: null,
    lastCheckedAt: '2026-05-07T16:00:00Z',
    lastSuccessAt: '2026-05-07T16:00:00Z',
    consecutiveFailures: 0
  })
})

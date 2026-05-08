const test = require('node:test')
const assert = require('node:assert')

const {
  MUSICBRAINZ_STATES,
  classifyMusicBrainzReport,
  buildMusicBrainzNetworkState,
  buildMusicBrainzSummary
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
    lastCheckedAt: '2026-05-07T16:00:00Z',
    lastSuccessAt: '2026-05-07T16:00:00Z',
    consecutiveFailures: 0
  })
})

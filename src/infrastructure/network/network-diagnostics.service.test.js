const test = require('node:test')
const assert = require('node:assert')

const {
  MUSICBRAINZ_STATES
} = require('./network-state')

const networkDiagnostics = require('./network-diagnostics.service')

test('network diagnostics starts with unknown cached MusicBrainz state and does not probe', () => {
  networkDiagnostics.resetNetworkDiagnosticsForTest()

  const cached = networkDiagnostics.getCachedNetworkDiagnostics()
  assert.strictEqual(cached.status, 'unknown')
  assert.strictEqual(cached.summary.musicbrainz.state, MUSICBRAINZ_STATES.UNKNOWN)
  assert.strictEqual(cached.summary.musicbrainz.policy, 'ipv6_only')
  assert.strictEqual(cached.summary.musicbrainz.fallbackAllowed, false)
})

test('refreshNetworkDiagnostics caches successful MusicBrainz IPv6 report', async () => {
  networkDiagnostics.resetNetworkDiagnosticsForTest()
  let calls = 0

  const first = await networkDiagnostics.refreshNetworkDiagnostics({
    probeMusicBrainz: async () => {
      calls += 1
      return {
        provider: 'musicbrainz',
        ok: true,
        failedStep: null,
        checkedAt: '2026-05-07T16:00:00Z',
        dns: {
          addresses: [{ address: '2a01:4f8:c011:f68::1', family: 6 }],
          errors: {}
        },
        tcp: { connected: true },
        tls: { protocol: 'TLSv1.3' }
      }
    }
  })

  assert.strictEqual(calls, 1)
  assert.strictEqual(first.status, 'ok')
  assert.strictEqual(first.providers.musicbrainz.state, MUSICBRAINZ_STATES.HEALTHY)
  assert.strictEqual(first.providers.musicbrainz.lastSuccessAt, '2026-05-07T16:00:00Z')

  const cached = await networkDiagnostics.getNetworkDiagnostics()
  assert.strictEqual(calls, 1)
  assert.strictEqual(cached.providers.musicbrainz.state, MUSICBRAINZ_STATES.HEALTHY)
})

test('refreshNetworkDiagnostics increments consecutive failures and preserves last success', async () => {
  networkDiagnostics.resetNetworkDiagnosticsForTest()

  await networkDiagnostics.refreshNetworkDiagnostics({
    probeMusicBrainz: async () => ({
      provider: 'musicbrainz',
      ok: true,
      checkedAt: '2026-05-07T16:00:00Z',
      dns: { addresses: [{ address: '2a01:4f8:c011:f68::1', family: 6 }], errors: {} }
    })
  })

  const failed = await networkDiagnostics.refreshNetworkDiagnostics({
    probeMusicBrainz: async () => ({
      provider: 'musicbrainz',
      ok: false,
      failedStep: 'tls',
      checkedAt: '2026-05-07T16:15:00Z',
      error: { code: 'ECONNRESET', message: 'TLS reset' },
      dns: { addresses: [{ address: '2a01:4f8:c011:f68::1', family: 6 }], errors: {} }
    })
  })

  assert.strictEqual(failed.status, 'degraded')
  assert.strictEqual(failed.providers.musicbrainz.state, MUSICBRAINZ_STATES.TLS_FAILED)
  assert.strictEqual(failed.providers.musicbrainz.consecutiveFailures, 1)
  assert.strictEqual(failed.providers.musicbrainz.lastSuccessAt, '2026-05-07T16:00:00Z')
})

test('buildNetworkHealthSummary reads cached state without forcing a live probe', async () => {
  networkDiagnostics.resetNetworkDiagnosticsForTest()

  await networkDiagnostics.refreshNetworkDiagnostics({
    probeMusicBrainz: async () => ({
      provider: 'musicbrainz',
      ok: false,
      failedStep: 'dns',
      checkedAt: '2026-05-07T16:00:00Z',
      error: { code: 'ENODATA', message: 'No AAAA' },
      dns: { addresses: [], errors: { v6: 'ENODATA' } }
    })
  })

  const summary = networkDiagnostics.buildNetworkHealthSummary()
  assert.strictEqual(summary.musicbrainz.state, MUSICBRAINZ_STATES.DNS_FAILED)
  assert.strictEqual(summary.musicbrainz.lastCheckedAt, '2026-05-07T16:00:00Z')
})

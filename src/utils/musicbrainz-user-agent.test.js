const test = require('node:test')
const assert = require('node:assert')
const {
  buildMusicBrainzUserAgent,
  musicBrainzUserAgentStatus,
  validateMusicBrainzContact
} = require('./musicbrainz-user-agent')

test('validateMusicBrainzContact accepts real email addresses', () => {
  const result = validateMusicBrainzContact('operator@melodarr.org')
  assert.strictEqual(result.valid, true)
  assert.strictEqual(result.type, 'email')
})

test('validateMusicBrainzContact rejects example/test placeholder emails', () => {
  for (const contact of ['admin@example.com', 'test@example.org', 'fake@example.net', 'test@real-domain.test']) {
    const result = validateMusicBrainzContact(contact)
    assert.strictEqual(result.valid, false)
    assert.strictEqual(result.code, 'PLACEHOLDER_CONTACT')
  }
})

test('validateMusicBrainzContact accepts real contact URLs', () => {
  const result = validateMusicBrainzContact('https://github.com/melodarr/melodarr-proxy')
  assert.strictEqual(result.valid, true)
  assert.strictEqual(result.type, 'url')
})

test('validateMusicBrainzContact rejects missing or malformed contact values', () => {
  assert.strictEqual(validateMusicBrainzContact('').code, 'MISSING_CONTACT')
  assert.strictEqual(validateMusicBrainzContact('not-an-email').code, 'INVALID_CONTACT')
})

test('buildMusicBrainzUserAgent formats application identity without exposing validation state', () => {
  assert.strictEqual(
    buildMusicBrainzUserAgent({
      appName: 'melodarr-proxy',
      appVersion: '0.4.1',
      appContact: 'operator@melodarr.org'
    }),
    'melodarr-proxy/0.4.1 (operator@melodarr.org)'
  )
})

test('musicBrainzUserAgentStatus returns contract-safe invalid-contact metadata', () => {
  const result = musicBrainzUserAgentStatus({
    appName: 'melodarr-proxy',
    appVersion: '0.4.1',
    appContact: 'admin@example.com'
  })

  assert.strictEqual(result.valid, false)
  assert.strictEqual(result.contactType, 'email')
  assert.strictEqual(result.code, 'PLACEHOLDER_CONTACT')
  assert.match(result.recommendation, /APP_CONTACT/)
})

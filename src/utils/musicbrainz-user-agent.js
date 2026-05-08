const PLACEHOLDER_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'test.org',
  'test.net',
  'invalid',
  'localhost',
  'test'
])

const PLACEHOLDER_LOCAL_PARTS = new Set([
  'example',
  'fake',
  'test'
])

function normalizeContact (contact) {
  return String(contact || '').trim()
}

function isPlaceholderHostname (hostname) {
  const normalized = String(hostname || '').toLowerCase()
  return PLACEHOLDER_DOMAINS.has(normalized) ||
    normalized.endsWith('.example.com') ||
    normalized.endsWith('.example.org') ||
    normalized.endsWith('.example.net') ||
    normalized.endsWith('.test.com') ||
    normalized.endsWith('.test.org') ||
    normalized.endsWith('.test.net')
}

function parseContactUrl (contact) {
  try {
    const parsed = new URL(contact)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed
  } catch (_err) {
    return null
  }
}

function validateMusicBrainzContact (contact) {
  const value = normalizeContact(contact)

  if (!value) {
    return {
      valid: false,
      type: null,
      code: 'MISSING_CONTACT',
      message: 'APP_CONTACT is required for MusicBrainz requests.'
    }
  }

  const emailMatch = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(value)
  if (emailMatch) {
    const local = emailMatch[1].toLowerCase()
    const domain = emailMatch[2].toLowerCase()

    if (isPlaceholderHostname(domain) || PLACEHOLDER_LOCAL_PARTS.has(local)) {
      return {
        valid: false,
        type: 'email',
        code: 'PLACEHOLDER_CONTACT',
        message: 'APP_CONTACT must be a real operator email or contact URL, not an example/test address.'
      }
    }

    return { valid: true, type: 'email', code: null, message: null }
  }

  const url = parseContactUrl(value)
  if (url) {
    if (isPlaceholderHostname(url.hostname)) {
      return {
        valid: false,
        type: 'url',
        code: 'PLACEHOLDER_CONTACT',
        message: 'APP_CONTACT must be a real operator email or contact URL, not an example/test URL.'
      }
    }

    return { valid: true, type: 'url', code: null, message: null }
  }

  return {
    valid: false,
    type: null,
    code: 'INVALID_CONTACT',
    message: 'APP_CONTACT must be a real email address or http(s) contact URL.'
  }
}

function buildMusicBrainzUserAgent ({ appName, appVersion, appContact }) {
  return `${String(appName || 'melodarr-proxy').trim()}/${String(appVersion || 'unknown').trim()} (${normalizeContact(appContact)})`
}

function musicBrainzUserAgentStatus ({ appName, appVersion, appContact }) {
  const validation = validateMusicBrainzContact(appContact)
  return {
    valid: validation.valid,
    contactType: validation.type,
    code: validation.code,
    message: validation.message,
    recommendation: validation.valid
      ? null
      : 'Set APP_CONTACT to a real email address or contact URL before relying on MusicBrainz.'
  }
}

module.exports = {
  buildMusicBrainzUserAgent,
  musicBrainzUserAgentStatus,
  validateMusicBrainzContact
}

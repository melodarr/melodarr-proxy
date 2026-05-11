const TRUSTED_IMAGE_HOSTS = Object.freeze([
  'coverartarchive.org',
  'archive.org',
  'theaudiodb.com',
  'discogs.com',
  'lastfm.freetls.fastly.net',
  'mzstatic.com'
])

function isTrustedImageUrl (value) {
  try {
    const parsed = new URL(String(value))
    if (parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return TRUSTED_IMAGE_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`))
  } catch (_) {
    return false
  }
}

function requestOrigin (req) {
  const proto = String(req.get?.('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim()
  const host = req.get?.('x-forwarded-host') || req.get?.('host')
  return host ? `${proto}://${host}` : ''
}

function buildImageProxyUrl (url, req) {
  const source = String(url || '').trim()
  if (!source || !isTrustedImageUrl(source)) return source

  const origin = requestOrigin(req)
  if (!origin) return source

  try {
    const parsed = new URL(source)
    if (parsed.origin === origin && parsed.pathname === '/api/image') return source
  } catch (_) {}

  return `${origin}/api/image?url=${encodeURIComponent(source)}`
}

function proxifyImageUrls (value, req) {
  if (Array.isArray(value)) {
    return value.map(item => proxifyImageUrls(item, req))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const out = {}
  for (const [key, item] of Object.entries(value)) {
    out[key] = proxifyImageUrls(item, req)
  }

  if (typeof out.remoteCover === 'string') {
    out.remoteCover = buildImageProxyUrl(out.remoteCover, req)
  }

  if (Object.prototype.hasOwnProperty.call(out, 'coverType')) {
    if (typeof out.url === 'string') {
      out.url = buildImageProxyUrl(out.url, req)
    }
    if (typeof out.remoteUrl === 'string') {
      out.remoteUrl = buildImageProxyUrl(out.remoteUrl, req)
    }
  }

  return out
}

module.exports = {
  buildImageProxyUrl,
  isTrustedImageUrl,
  proxifyImageUrls
}

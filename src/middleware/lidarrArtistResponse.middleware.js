const { normalizeLidarrArtistResponse } = require('../utils/lidarrArtist')

function isStrictSkyhookMetadataRoute (req) {
  const path = String(req.path || req.url || '').split('?')[0]
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return false

  const last = parts.at(-1)
  const normalizedLast = String(last).toLowerCase()
  const routeName = parts.at(-2)

  if (normalizedLast === 'search') return routeName !== 'artist'
  if (normalizedLast === 'release') return true
  if (normalizedLast === 'details' && routeName === 'queue') return true
  if (normalizedLast === 'discover') return routeName === 'artist'
  if (normalizedLast === 'lookup') return false

  return routeName === 'artist' || routeName === 'album'
}

function lidarrArtistResponseMiddleware (req, res, next) {
  const originalJson = res.json.bind(res)
  res.json = (body) => originalJson(isStrictSkyhookMetadataRoute(req) ? body : normalizeLidarrArtistResponse(body))
  next()
}

module.exports = lidarrArtistResponseMiddleware

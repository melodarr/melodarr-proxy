const { normalizeLidarrArtistResponse } = require('../utils/lidarrArtist')

function isStrictSkyhookMetadataRoute (req) {
  const path = String(req.path || req.url || '').split('?')[0]
  const parts = path.split('/').filter(Boolean)
  if (parts.length < 2) return false

  const last = parts.at(-1)
  if (['lookup', 'discover', 'search'].includes(String(last).toLowerCase())) return false

  const routeName = parts.at(-2)
  return routeName === 'artist' || routeName === 'album'
}

function lidarrArtistResponseMiddleware (req, res, next) {
  const originalJson = res.json.bind(res)
  res.json = (body) => originalJson(isStrictSkyhookMetadataRoute(req) ? body : normalizeLidarrArtistResponse(body))
  next()
}

module.exports = lidarrArtistResponseMiddleware

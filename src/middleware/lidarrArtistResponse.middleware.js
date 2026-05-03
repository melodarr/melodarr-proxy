const { normalizeLidarrArtistResponse } = require('../utils/lidarrArtist')

function lidarrArtistResponseMiddleware (_req, res, next) {
  const originalJson = res.json.bind(res)
  res.json = (body) => originalJson(normalizeLidarrArtistResponse(body))
  next()
}

module.exports = lidarrArtistResponseMiddleware

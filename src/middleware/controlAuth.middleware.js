const { checkRateLimit } = require('../auth/apikeys')
const { isAuthenticated } = require('../controllers/settings.controller')
const metrics = require('../metrics')
const logger = require('../utils/logger')

function controlAuthMiddleware (req, res, next) {
  // Settings session auth always succeeds
  if (isAuthenticated(req)) {
    return next()
  }

  // Fallback to strict API key check (bypasses REQUIRE_API_KEY=false)
  const key = req.headers['x-api-key']

  if (!key) {
    return res.status(401).json({ error: 'Authentication required. Provide settings session cookie or API key.' })
  }

  const result = checkRateLimit(key)

  if (!result.valid) {
    const maskedKey = key.substring(0, 8) + '***'
    metrics.recordApiKeyError(maskedKey)

    if (result.reason === 'invalid_key') {
      logger.warn(`Invalid API key attempted on control route: ${maskedKey}`)
      return res.status(403).json({ error: 'Invalid API key' })
    } else if (result.reason === 'quota_exceeded') {
      logger.warn(`API key quota exceeded on control route for key: ${maskedKey}`)
      return res.status(429).json({ error: 'Rate limit exceeded' })
    }
  }

  next()
}

module.exports = controlAuthMiddleware

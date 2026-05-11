const { checkRateLimit, hasKeys } = require('../auth/apikeys')
const metrics = require('../metrics')
const logger = require('../utils/logger')

function apiKeyMiddleware (req, res, next) {
  if (process.env.REQUIRE_API_KEY === 'false') {
    req.apiClient = 'Local Client (Unauthenticated)'
    req.apiKeyId = 'unauth'
    req.apiKeyMasked = 'unauth'
    req.requestStartTime = Date.now()

    res.on('finish', () => {
      const latency = Date.now() - req.requestStartTime
      const isError = res.statusCode >= 400
      metrics.recordApiRequest(req.apiKeyMasked, !isError, latency)
    })

    return next()
  }

  if (!hasKeys()) {
    req.apiClient = 'Local Client (No API Key Configured)'
    req.apiKeyId = 'no-key-configured'
    req.apiKeyMasked = 'no-key-configured'
    req.requestStartTime = Date.now()

    res.on('finish', () => {
      const latency = Date.now() - req.requestStartTime
      const isError = res.statusCode >= 400
      metrics.recordApiRequest(req.apiKeyMasked, !isError, latency)
    })

    return next()
  }

  const key = req.pathApiKey || req.headers['x-api-key'] || req.query.api_key || req.query.apikey

  if (!key) {
    metrics.recordApiRequest('unknown', false, 0) // Need to adjust this or pass undefined
    return res.status(401).json({ error: 'Missing API key. Provide x-api-key header or api_key query parameter.' })
  }

  const result = checkRateLimit(key)

  if (!result.valid) {
    // Mask key for logging
    const maskedKey = key.substring(0, 8) + '***'
    metrics.recordApiKeyError(maskedKey)

    if (result.reason === 'invalid_key') {
      logger.warn(`Invalid API key attempted: ${maskedKey}`)
      return res.status(403).json({ error: 'Invalid API key' })
    } else if (result.reason === 'quota_exceeded') {
      logger.warn(`API key quota exceeded for key: ${maskedKey}`)
      return res.status(429).json({ error: 'Rate limit exceeded' })
    }
  }

  req.apiClient = result.name
  req.apiKeyId = result.id
  req.apiKeyMasked = `${result.id}:${result.name}`
  req.requestStartTime = Date.now()

  // Hook response to record metrics on finish
  res.on('finish', () => {
    const latency = Date.now() - req.requestStartTime
    const isError = res.statusCode >= 400
    metrics.recordApiRequest(req.apiKeyMasked, !isError, latency)
  })

  next()
}

module.exports = apiKeyMiddleware

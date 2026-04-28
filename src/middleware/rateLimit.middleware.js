const logger = require('../utils/logger')

// Simple in-memory sliding window rate limiter
const store = new Map()

// Default: 60 requests per minute
const rateLimit = (options = {}) => {
  const windowMs = options.windowMs || 60 * 1000
  const max = options.max || 60
  const message = options.message || 'Too many requests, please try again later.'

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress
    const now = Date.now()

    if (!store.has(ip)) {
      store.set(ip, [])
    }

    const timestamps = store.get(ip)

    // Remove expired timestamps
    const windowStart = now - windowMs
    while (timestamps.length > 0 && timestamps[0] < windowStart) {
      timestamps.shift()
    }

    if (timestamps.length >= max) {
      logger.warn('Rate limit exceeded', { ip, path: req.path })
      return res.status(429).json({
        error: message,
        retryAfter: Math.ceil((timestamps[0] + windowMs - now) / 1000)
      })
    }

    timestamps.push(now)
    next()
  }
}

module.exports = rateLimit

const logger = require('../utils/logger')

// Default: 60 requests per minute
const rateLimit = (options = {}) => {
  // Simple in-memory sliding window rate limiter
  const store = new Map()

  const windowMs = options.windowMs || 60 * 1000
  const message = options.message || 'Too many requests, please try again later.'
  const keyGenerator = options.keyGenerator || ((req) => req.ip || req.connection?.remoteAddress || 'unknown')

  // Periodic cleanup to prevent memory leaks for one-off IPs
  const interval = setInterval(() => {
    const now = Date.now()
    for (const [ip, record] of store.entries()) {
      const windowStart = now - record.windowMs
      while (record.timestamps.length > 0 && record.timestamps[0] < windowStart) {
        record.timestamps.shift()
      }
      if (record.timestamps.length === 0) {
        store.delete(ip)
      }
    }
  }, 60 * 1000)

  if (interval.unref) {
    interval.unref()
  }

  return (req, res, next) => {
    const ip = keyGenerator(req)
    const now = Date.now()
    const max = typeof options.max === 'function' ? options.max() : (options.max || 60)

    if (!store.has(ip)) {
      store.set(ip, { timestamps: [], windowMs })
    }

    const record = store.get(ip)
    const timestamps = record.timestamps

    // Keep cleanup and request trimming aligned with the current window
    record.windowMs = windowMs

    // Remove expired timestamps
    const windowStart = now - windowMs
    while (timestamps.length > 0 && timestamps[0] < windowStart) {
      timestamps.shift()
    }

    if (timestamps.length >= max) {
      logger.warn('Rate limit exceeded', { ip, path: req.path })
      const retryAfterSeconds = Math.ceil((timestamps[0] + windowMs - now) / 1000)
      res.setHeader('Retry-After', retryAfterSeconds)
      return res.status(429).json({
        error: message,
        retryAfter: retryAfterSeconds
      })
    }

    timestamps.push(now)
    next()
  }
}

module.exports = rateLimit

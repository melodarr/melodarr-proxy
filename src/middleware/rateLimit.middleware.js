const logger = require('../utils/logger')

// Simple in-memory sliding window rate limiter
const store = new Map()

// Periodic cleanup to prevent memory leaks for one-off IPs
setInterval(() => {
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
}, 60 * 1000).unref()

// Default: 60 requests per minute
const rateLimit = (options = {}) => {
  const windowMs = options.windowMs || 60 * 1000
  const message = options.message || 'Too many requests, please try again later.'
  const keyGenerator = options.keyGenerator || ((req) => req.ip || req.connection?.remoteAddress || 'unknown')

  return (req, res, next) => {
    const ip = keyGenerator(req)
    const now = Date.now()
    const max = typeof options.max === 'function' ? options.max() : (options.max || 60)

    if (!store.has(ip)) {
      store.set(ip, { timestamps: [], windowMs })
    }

    const record = store.get(ip)
    const timestamps = record.timestamps

    // Update windowMs if it changed (unlikely, but safe)
    record.windowMs = Math.max(record.windowMs, windowMs)

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

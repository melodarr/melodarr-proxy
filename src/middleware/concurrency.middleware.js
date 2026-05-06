const logger = require('../utils/logger')

const storeSettings = require('../settings/store')

let activeRequests = 0

const concurrencyLimit = (req, res, next) => {
  const maxConcurrent = storeSettings.getConfigValue('maxConcurrentRequests') || 20

  if (activeRequests >= maxConcurrent) {
    logger.warn('Concurrency limit exceeded', { path: req.path, activeRequests, maxConcurrent })
    return res.status(503).json({
      error: 'Service unavailable, too many concurrent requests'
    })
  }

  activeRequests++

  // Hook into response finish or close
  res.on('finish', () => {
    activeRequests--
  })
  res.on('close', () => {
    if (!res.writableEnded) {
      activeRequests--
    }
  })

  next()
}

module.exports = concurrencyLimit

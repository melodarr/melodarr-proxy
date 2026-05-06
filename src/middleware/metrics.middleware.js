const metrics = require('../metrics')

function metricsMiddleware (req, res, next) {
  const start = process.hrtime()

  res.on('finish', () => {
    // Track requests to /api/ (could be all requests, but let's do all for simplicity)
    if (req.originalUrl.startsWith('/api/')) {
      const isSuccess = res.statusCode < 400
      const endpoint = req.route ? req.route.path : req.path
      metrics.recordRequest({ endpoint, success: isSuccess })
      if (res.statusCode >= 400 && res.statusCode !== 503) {
        metrics.recordError()
      }

      const diff = process.hrtime(start)
      const timeMs = Math.round((diff[0] * 1e9 + diff[1]) / 1e6)
      metrics.recordLatency(timeMs)
    }
  })

  next()
}

module.exports = metricsMiddleware

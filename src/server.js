const express = require('express')
const path = require('path')
const crypto = require('crypto')

if (!process.env.INSTANCE_ID) {
  process.env.INSTANCE_ID = crypto.randomBytes(4).toString('hex')
}

const logger = require('./utils/logger')
const cacheLayer = require('./cache')
const upstreamService = require('./services/upstream.service')

// ── CLI Commands (run before server boots) ───────────────────────
if (process.argv.includes('--reset-password')) {
  const { resetPassword } = require('./settings/store')
  const result = resetPassword()

  if (result.cleared) {
    logger.info('Password cleared. The setup flow will appear on next login.', { context: 'CLI' })
  } else {
    logger.error(result.reason, { context: 'CLI' })
  }

  process.exit(0)
}

const metricsMiddleware = require('./middleware/metrics.middleware')
const apiRoutes = require('./routes/api.routes')
const debugRoutes = require('./routes/debug.routes')

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
// Custom CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With')
  if (req.method === 'OPTIONS') {
    res.sendStatus(200)
  } else {
    next()
  }
})
app.use(express.json())

// Metrics tracking for all routes
app.use(metricsMiddleware)

// Versioning + Release Identity Endpoint
app.get('/api/version', (req, res) => {
  res.json({
    app: process.env.APP_NAME || 'Melodarr Proxy',
    version: process.env.APP_VERSION || '0.2.0',
    environment: process.env.NODE_ENV || 'development'
  })
})

// API Routes
app.use('/api', apiRoutes)
app.use('/debug', debugRoutes)

// Serve static frontend
app.use(express.static(path.join(__dirname, '../public')))

// Fallback for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    error: 'API route not found'
  })
})

// ── Startup Validation (Fail-Fast System) ───────────────────────
async function boot () {
  logger.info('Starting boot sequence...')

  // 1. Validate Cache Connection
  try {
    const isCacheConnected = await cacheLayer.isReady()
    if (isCacheConnected) {
      logger.info('Cache connection validated.')
    } else {
      logger.warn('Redis cache is not connected. Will fallback to in-memory caching.')
    }
  } catch (err) {
    logger.warn('Failed to validate cache connection.', { error: err.message })
  }

  // 2. Validate Upstream Connectivity
  try {
    const upstreamHealth = await upstreamService.checkHealth()
    if (!upstreamHealth) {
      throw new Error('Upstream API is unreachable.')
    }
    logger.info('Upstream connectivity validated.')
  } catch (err) {
    logger.error('Boot failed: Upstream validation error.', { error: err.message })
    process.exit(1)
  }

  // Start background jobs
  require('./jobs').startJobs()

  // Start server
  if (!process.env.NO_LISTEN) {
    if (typeof PORT === 'string' && PORT.startsWith('/')) {
      app.listen(PORT, () => {
        logger.info(`Production proxy running on socket ${PORT}`)
        logger.info(`Health Check: curl --unix-socket ${PORT} http://localhost/api/health`)
      })
    } else {
      app.listen(PORT, '0.0.0.0', () => {
        logger.info(`Production proxy running on port ${PORT}`)
        logger.info(`Health Check: http://localhost:${PORT}/api/health`)
      })
    }
  } else {
    logger.info('Skipping app.listen due to NO_LISTEN flag.')
  }
}

boot()
module.exports = app

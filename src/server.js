const express = require('express')
const path = require('path')
const crypto = require('crypto')

if (!process.env.INSTANCE_ID) {
  process.env.INSTANCE_ID = crypto.randomBytes(4).toString('hex')
}

const logger = require('./utils/logger')
const cacheLayer = require('./cache')
const upstreamMonitor = require('./monitors/upstream.monitor')

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
const openApiDocument = require('./openapi')

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
// Custom CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, X-Api-Key')
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
    version: process.env.APP_VERSION || '0.3.13',
    revision: process.env.APP_REVISION || 'unknown',
    created: process.env.APP_CREATED || 'unknown',
    environment: process.env.NODE_ENV || 'development'
  })
})

app.get('/openapi.json', (req, res) => {
  res.json(openApiDocument)
})

app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/docs.html'))
})

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'))
})

app.get('/stats', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/stats.html'))
})

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/settings.html'))
})

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'))
})

app.get('/api/info', (req, res) => {
  res.json({
    app: process.env.APP_NAME || 'Melodarr Proxy',
    version: process.env.APP_VERSION || '0.3.13',
    role: 'api',
    docs: '/docs',
    openapi: '/openapi.json',
    health: '/api/health'
  })
})

app.use(express.static(path.join(__dirname, '../public')))
// API Routes
app.use('/api', apiRoutes)
app.use('/debug', debugRoutes)

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

  // 2. Prime upstream monitor with a single direct probe (no queue).
  // The monitor retries on its own interval, and /api/ready reflects
  // cached state, so we never hard-fail boot on upstream issues. The
  // proxy must start so operators can reach Settings and reconfigure
  // (e.g., switch musicbrainzIpFamily) when transient TLS/DNS issues
  // hit the boot probe.
  const initial = await upstreamMonitor.runCheck()
  if (initial.status === 'healthy') {
    logger.info('Upstream connectivity validated.')
  } else {
    logger.warn('Upstream not healthy at boot; continuing — monitor will retry.', {
      status: initial.status,
      error: initial.lastError
    })
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

const express = require('express')
const path = require('path')
const crypto = require('crypto')

if (!process.env.INSTANCE_ID) {
  process.env.INSTANCE_ID = crypto.randomBytes(4).toString('hex')
}

const logger = require('./utils/logger')
const cacheLayer = require('./cache')
const upstreamMonitor = require('./monitors/upstream.monitor')
const { getAppVersion } = require('./utils/version')

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
const requestIdMiddleware = require('./middleware/requestId.middleware')
const corsMiddleware = require('./middleware/cors.middleware')
const apiRoutes = require('./routes/api.routes')
const debugRoutes = require('./routes/debug.routes')
const publicRoutes = require('./routes/public.routes')
const openApiDocument = require('./openapi')

const PATH_API_KEY_SEGMENT_RE = /^(?:mp_[A-Za-z0-9_-]+|[a-f0-9]{32,64})$/i

function redactPathApiKeys (value = '') {
  return String(value)
    .split('/')
    .map((segment) => {
      const [pathPart, ...suffixParts] = segment.split('?')
      const redactedPathPart = PATH_API_KEY_SEGMENT_RE.test(pathPart) ? '[redacted-api-key]' : pathPart
      return suffixParts.length ? `${redactedPathPart}?${suffixParts.join('?')}` : redactedPathPart
    })
    .join('/')
}

function createApp () {
  const app = express()

  // RequestId / ALS scope must be first so every downstream middleware,
  // controller, and async hop sees the correlation id.
  app.use(requestIdMiddleware)

  app.use(corsMiddleware)
  app.use(express.json())

  // Metrics tracking for all routes
  app.use(metricsMiddleware)

  // Versioning + Release Identity Endpoint
  app.get('/api/version', (req, res) => {
    res.json({
      app: process.env.APP_NAME || 'Melodarr Proxy',
      version: getAppVersion(),
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
      version: getAppVersion(),
      role: 'api',
      docs: '/docs',
      openapi: '/openapi.json',
      health: '/api/health'
    })
  })

  app.use(express.static(path.join(__dirname, '../public')))
  // Legacy/public metadata compatibility routes, e.g. /artist/search.
  app.use('/', publicRoutes)
  // API Routes
  app.use('/api', apiRoutes)
  app.use('/debug', debugRoutes)

  // Fallback for unmatched routes
  app.use((req, res) => {
    const queryKeys = Object.keys(req.query || {}).filter(key => !/api[_-]?key|apikey|token|secret/i.test(key))
    const originalUrl = redactPathApiKeys(req.originalUrl)
    const path = redactPathApiKeys(req.path)
    logger.warn('Route not found', {
      requestId: req.requestId,
      method: req.method,
      originalUrl,
      path,
      queryKeys,
      userAgent: req.headers?.['user-agent']
    })
    res.status(404).json({
      error: 'API route not found'
    })
  })

  return app
}

const PORT = process.env.PORT || 3000

// ── Startup Validation (Fail-Fast System) ───────────────────────
async function boot (appInstance) {
  logger.info('Starting boot sequence...')

  // Surface saved runtime overrides that are shadowing different env values.
  // Saved-wins precedence is intentional, but operators who change an env var
  // and don't see the new value need to know a saved override is in the way.
  try {
    const { getEnvShadowedKeys } = require('./settings/store')
    for (const entry of getEnvShadowedKeys()) {
      logger.warn('Saved runtime override is shadowing env variable', {
        key: entry.key,
        envName: entry.envName,
        savedValue: entry.savedValue,
        envValue: entry.envValue,
        hint: `DELETE /api/settings/runtime/${entry.key} (or PATCH /api/settings with { "${entry.key}": null }) to clear the saved override and pick up the env value.`
      })
    }
  } catch (err) {
    logger.warn('Failed to check for shadowed env settings', { error: err.message })
  }

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
      appInstance.listen(PORT, () => {
        logger.info(`Production proxy running on socket ${PORT}`)
        logger.info(`Health Check: curl --unix-socket ${PORT} http://localhost/api/health`)
      })
    } else {
      appInstance.listen(PORT, '0.0.0.0', () => {
        logger.info(`Production proxy running on port ${PORT}`)
        logger.info(`Health Check: http://localhost:${PORT}/api/health`)
      })
    }
  } else {
    logger.info('Skipping appInstance.listen due to NO_LISTEN flag.')
  }

  const { flushSettingsWrites } = require('./settings/store')
  let shuttingDown = false

  async function gracefulShutdown (signal) {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`Received ${signal}. Starting graceful shutdown...`)
    try {
      await flushSettingsWrites()
      logger.info('Settings flushed to disk.')
    } catch (err) {
      logger.error('Error flushing settings to disk during shutdown', { error: err.message })
    }
    process.exit(0)
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('beforeExit', async () => {
    if (!shuttingDown) {
      await flushSettingsWrites()
    }
  })
}

if (require.main === module) {
  const appInstance = createApp()
  boot(appInstance)
}

module.exports = { createApp, boot }

const store = require('../settings/store')
const logger = require('./logger')

function validateStartup () {
  const errors = []

  // Validate cache config
  const cacheTtl = store.getConfigValue('cacheTtlSeconds')
  if (typeof cacheTtl !== 'number' || !Number.isFinite(cacheTtl) || cacheTtl <= 0) {
    errors.push('Invalid cacheTtlSeconds configuration (must be a positive number).')
  }

  // Validate timeouts
  const upstreamTimeoutMs = store.getConfigValue('upstreamTimeoutMs')
  if (typeof upstreamTimeoutMs !== 'number' || !Number.isFinite(upstreamTimeoutMs) || upstreamTimeoutMs <= 0) {
    errors.push('Invalid upstreamTimeoutMs configuration (must be a positive number).')
  }

  const serverTimeoutMs = store.getConfigValue('serverTimeoutMs')
  if (typeof serverTimeoutMs !== 'number' || !Number.isFinite(serverTimeoutMs) || serverTimeoutMs <= 0) {
    errors.push('Invalid serverTimeoutMs configuration (must be a positive number).')
  }

  // Validate rate limits
  const minRequestIntervalMs = store.getConfigValue('minRequestIntervalMs')
  if (typeof minRequestIntervalMs !== 'number' || !Number.isFinite(minRequestIntervalMs) || minRequestIntervalMs < 0) {
    errors.push('Invalid minRequestIntervalMs configuration (must be a non-negative number).')
  }

  const globalRateLimitMax = store.getConfigValue('globalRateLimitMax')
  if (typeof globalRateLimitMax !== 'number' || !Number.isFinite(globalRateLimitMax) || globalRateLimitMax <= 0) {
    errors.push('Invalid globalRateLimitMax configuration (must be a positive number).')
  }

  const maxConcurrentRequests = store.getConfigValue('maxConcurrentRequests')
  if (typeof maxConcurrentRequests !== 'number' || !Number.isFinite(maxConcurrentRequests) || maxConcurrentRequests <= 0) {
    errors.push('Invalid maxConcurrentRequests configuration (must be a positive number).')
  }

  const upstreamQueueMax = store.getConfigValue('upstreamQueueMax')
  if (typeof upstreamQueueMax !== 'number' || !Number.isFinite(upstreamQueueMax) || upstreamQueueMax <= 0) {
    errors.push('Invalid upstreamQueueMax configuration (must be a positive number).')
  }

  // Validate provider configs
  const musicbrainzBaseUrl = store.getConfigValue('musicbrainzBaseUrl')
  if (!musicbrainzBaseUrl || typeof musicbrainzBaseUrl !== 'string') {
    errors.push('Invalid musicbrainzBaseUrl configuration (must be a valid HTTP URL).')
  } else {
    try {
      const parsedMusicbrainzBaseUrl = new URL(musicbrainzBaseUrl)
      if (parsedMusicbrainzBaseUrl.protocol !== 'http:' && parsedMusicbrainzBaseUrl.protocol !== 'https:') {
        errors.push('Invalid musicbrainzBaseUrl configuration (must be a valid HTTP URL).')
      }
    } catch (err) {
      errors.push('Invalid musicbrainzBaseUrl configuration (must be a valid HTTP URL).')
    }
  }

  // Validate Redis configuration
  if (process.env.REDIS_ENABLED === 'true' && !process.env.REDIS_URL) {
    errors.push('Redis is enabled (REDIS_ENABLED=true) but REDIS_URL is missing.')
  }

  if (errors.length > 0) {
    errors.forEach(err => logger.error(`Startup Validation Failed: ${err}`))
    logger.error('System cannot start due to invalid configuration.')
    process.exit(1)
  }

  logger.info('Startup configuration validated successfully.')
}

module.exports = { validateStartup }

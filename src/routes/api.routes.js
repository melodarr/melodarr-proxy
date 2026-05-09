const express = require('express')
const router = express.Router()

const { getLiveness, getReadiness } = require('../controllers/health.controller')
const { getStats, getHistory } = require('../controllers/stats.controller')
const { handleAlbumById, handleArtistById, handleArtistDiscover, handleArtistLookup, handleQueueDetails, handleRecentFeed, handleReleaseSearch, handleSearch, handleSongAlbums } = require('../controllers/proxy.controller')
const { startProxy, stopProxy, clearCache, triggerSync } = require('../controllers/control.controller')
const { applyUpdate, getUpdateStatus } = require('../controllers/update.controller')
const { generateKey, getAllKeys, revokeKey } = require('../controllers/admin.controller')
const {
  clearRuntimeSetting,
  generateName,
  getNameHistory,
  getSettings,
  getSettingsStatus,
  loginSettings,
  logoutSettings,
  requireSettingsAuth,
  requireSettingsCsrf,
  requireSettingsCsrfIfSession,
  setupSettings,
  testSettingsProvider,
  updateSettings,
  listVersions,
  getVersion,
  applyRollback,
  getCurrentVersionMeta,
  validateSettingsEndpoint
} = require('../controllers/settings.controller')

const proxyStateMiddleware = require('../middleware/proxy.middleware')
const rateLimit = require('../middleware/rateLimit.middleware')
const lidarrArtistResponseMiddleware = require('../middleware/lidarrArtistResponse.middleware')

// Public monitoring
router.get('/health', getLiveness)
router.get('/ready', getReadiness)
router.get('/settings/status', getSettingsStatus)
router.post('/settings/setup', setupSettings)
router.post('/settings/login', loginSettings)
router.post('/settings/logout', requireSettingsAuth, requireSettingsCsrf, logoutSettings)
router.get('/update/status', getUpdateStatus)

// Authenticated monitoring/configuration
router.get('/stats', requireSettingsAuth, getStats)
router.get('/stats/history', requireSettingsAuth, getHistory)
router.get('/settings', requireSettingsAuth, getSettings)
router.patch('/settings', requireSettingsAuth, requireSettingsCsrf, updateSettings)
router.delete('/settings/runtime/:key', requireSettingsAuth, requireSettingsCsrf, clearRuntimeSetting)
router.post('/settings/generate-name', requireSettingsAuth, requireSettingsCsrf, generateName)
router.post('/settings/providers/test', requireSettingsAuth, requireSettingsCsrf, testSettingsProvider)
router.get('/settings/name-history', requireSettingsAuth, getNameHistory)
router.post('/update/apply', requireSettingsAuth, requireSettingsCsrf, applyUpdate)

router.get('/settings/versions', requireSettingsAuth, listVersions)
router.get('/settings/versions/:id', requireSettingsAuth, getVersion)
router.post('/settings/rollback', requireSettingsAuth, requireSettingsCsrf, applyRollback)
router.post('/settings/validate', requireSettingsAuth, requireSettingsCsrf, validateSettingsEndpoint)

// API Key Administration
router.post('/admin/keys/create', requireSettingsAuth, requireSettingsCsrf, generateKey)
router.get('/admin/keys', requireSettingsAuth, getAllKeys)
router.delete('/admin/keys/:key', requireSettingsAuth, requireSettingsCsrf, revokeKey)

// Main proxy route (requires proxy to be running)
const { getConfigValue } = require('../settings/store')
const proxyRateLimiter = rateLimit({ windowMs: 60 * 1000, max: () => getConfigValue('globalRateLimitMax') || 500 })
const proxyAuthMiddleware = require('../middleware/proxyAuth.middleware')

// Settings-auth protected version metadata
router.get('/settings/version', requireSettingsAuth, getCurrentVersionMeta)

router.use(lidarrArtistResponseMiddleware)

// Standard routes (Header or Query string API key)
router.get('/search', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleSearch)
router.get('/v1/artist/discover', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistDiscover)
router.get('/v1/artist/lookup', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistLookup)
router.get('/v0.4/artist/lookup', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistLookup)
router.get('/v1/song/albums', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleSongAlbums)
router.get('/release', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleReleaseSearch)
router.get('/v1/release', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleReleaseSearch)
router.get('/v1/queue/details', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleQueueDetails)
router.get('/album/:foreignAlbumId', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleAlbumById)
router.get('/v1/album/:foreignAlbumId', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleAlbumById)
router.get('/v0.4/album/:foreignAlbumId', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleAlbumById)
router.get('/artist/:foreignArtistId', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistById)
router.get('/v1/artist/:foreignArtistId', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistById)
router.get('/v0.4/artist/:foreignArtistId', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistById)
router.get('/recent/artist', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleRecentFeed)
router.get('/recent/album', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleRecentFeed)
router.get('/v1/recent/artist', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleRecentFeed)
router.get('/v1/recent/album', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleRecentFeed)
router.get('/v0.4/recent/artist', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleRecentFeed)
router.get('/v0.4/recent/album', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleRecentFeed)

// Path-based API key routes for Lidarr compatibility
// Lidarr's C# URI builder strips query parameters from base URLs, so we must allow the key in the path
const pathAuthMiddleware = (req, res, next) => {
  if (req.params.apiKey) {
    req.query.api_key = req.params.apiKey
    return next()
  }
  return next('route')
}

router.get('/:apiKey/search', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleSearch)
router.get('/:apiKey/v1/artist/discover', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistDiscover)
router.get('/:apiKey/v1/artist/lookup', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistLookup)
router.get('/:apiKey/v0.4/artist/lookup', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistLookup)
router.get('/:apiKey/v1/song/albums', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleSongAlbums)
router.get('/:apiKey/release', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleReleaseSearch)
router.get('/:apiKey/v1/release', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleReleaseSearch)
router.get('/:apiKey/v1/queue/details', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleQueueDetails)
router.get('/:apiKey/album/:foreignAlbumId', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleAlbumById)
router.get('/:apiKey/v1/album/:foreignAlbumId', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleAlbumById)
router.get('/:apiKey/v0.4/album/:foreignAlbumId', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleAlbumById)
router.get('/:apiKey/artist/:foreignArtistId', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistById)
router.get('/:apiKey/v1/artist/:foreignArtistId', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistById)
router.get('/:apiKey/v0.4/artist/:foreignArtistId', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistById)
router.get('/:apiKey/recent/artist', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleRecentFeed)
router.get('/:apiKey/recent/album', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleRecentFeed)
router.get('/:apiKey/v1/recent/artist', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleRecentFeed)
router.get('/:apiKey/v1/recent/album', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleRecentFeed)
router.get('/:apiKey/v0.4/recent/artist', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleRecentFeed)
router.get('/:apiKey/v0.4/recent/album', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleRecentFeed)

// Control routes
const controlAuthMiddleware = require('../middleware/controlAuth.middleware')

router.post('/proxy/start', proxyRateLimiter, controlAuthMiddleware, requireSettingsCsrfIfSession, startProxy)
router.post('/proxy/stop', proxyRateLimiter, controlAuthMiddleware, requireSettingsCsrfIfSession, stopProxy)
router.post('/cache/clear', proxyRateLimiter, controlAuthMiddleware, requireSettingsCsrfIfSession, clearCache)
router.post('/sync/trigger', proxyRateLimiter, controlAuthMiddleware, requireSettingsCsrfIfSession, triggerSync)

module.exports = router
module.exports.pathAuthMiddleware = pathAuthMiddleware

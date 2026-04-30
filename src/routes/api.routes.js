const express = require('express')
const router = express.Router()

const { getLiveness, getReadiness } = require('../controllers/health.controller')
const { getStats, getHistory } = require('../controllers/stats.controller')
const { handleArtistDiscover, handleArtistLookup, handleSearch, handleSongAlbums } = require('../controllers/proxy.controller')
const { startProxy, stopProxy, clearCache, triggerSync } = require('../controllers/control.controller')
const { applyUpdate, getUpdateStatus } = require('../controllers/update.controller')
const { generateKey, getAllKeys, revokeKey } = require('../controllers/admin.controller')
const {
  generateName,
  getNameHistory,
  getSettings,
  getSettingsStatus,
  loginSettings,
  logoutSettings,
  requireSettingsAuth,
  setupSettings,
  testSettingsProvider,
  updateSettings
} = require('../controllers/settings.controller')

const proxyStateMiddleware = require('../middleware/proxy.middleware')
const rateLimit = require('../middleware/rateLimit.middleware')

// Public monitoring
router.get('/health', getLiveness)
router.get('/ready', getReadiness)
router.get('/settings/status', getSettingsStatus)
router.post('/settings/setup', setupSettings)
router.post('/settings/login', loginSettings)
router.post('/settings/logout', logoutSettings)
router.get('/update/status', getUpdateStatus)

// Authenticated monitoring/configuration
router.get('/stats', requireSettingsAuth, getStats)
router.get('/stats/history', requireSettingsAuth, getHistory)
router.get('/settings', requireSettingsAuth, getSettings)
router.patch('/settings', requireSettingsAuth, updateSettings)
router.post('/settings/generate-name', requireSettingsAuth, generateName)
router.post('/settings/providers/test', requireSettingsAuth, testSettingsProvider)
router.get('/settings/name-history', requireSettingsAuth, getNameHistory)
router.post('/update/apply', requireSettingsAuth, applyUpdate)

// API Key Administration
router.post('/admin/keys/create', requireSettingsAuth, generateKey)
router.get('/admin/keys', requireSettingsAuth, getAllKeys)
router.delete('/admin/keys/:key', requireSettingsAuth, revokeKey)

// Main proxy route (requires proxy to be running)
const proxyRateLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 })
const proxyAuthMiddleware = require('../middleware/proxyAuth.middleware')

// Standard routes (Header or Query string API key)
router.get('/search', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleSearch)
router.get('/v1/artist/discover', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistDiscover)
router.get('/v1/artist/lookup', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistLookup)
router.get('/v1/song/albums', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleSongAlbums)

// Path-based API key routes for Lidarr compatibility
// Lidarr's C# URI builder strips query parameters from base URLs, so we must allow the key in the path
const pathAuthMiddleware = (req, res, next) => {
  if (req.params.apiKey && req.params.apiKey.startsWith('mp_')) {
    req.query.api_key = req.params.apiKey
    return next()
  }
  return next('route')
}

router.get('/:apiKey/search', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleSearch)
router.get('/:apiKey/v1/artist/discover', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistDiscover)
router.get('/:apiKey/v1/artist/lookup', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistLookup)
router.get('/:apiKey/v1/song/albums', pathAuthMiddleware, proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleSongAlbums)

// Control routes
router.post('/proxy/start', startProxy)
router.post('/proxy/stop', stopProxy)
router.post('/cache/clear', clearCache)
router.post('/sync/trigger', triggerSync)

module.exports = router

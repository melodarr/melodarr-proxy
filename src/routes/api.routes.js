const express = require('express')
const router = express.Router()

const { getHealth } = require('../controllers/health.controller')
const { getStats, getHistory } = require('../controllers/stats.controller')
const { handleArtistLookup, handleSearch } = require('../controllers/proxy.controller')
const { startProxy, stopProxy, clearCache, triggerSync } = require('../controllers/control.controller')
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
  updateSettings
} = require('../controllers/settings.controller')

const proxyStateMiddleware = require('../middleware/proxy.middleware')
const rateLimit = require('../middleware/rateLimit.middleware')

// Public monitoring
router.get('/health', getHealth)
router.get('/settings/status', getSettingsStatus)
router.post('/settings/setup', setupSettings)
router.post('/settings/login', loginSettings)
router.post('/settings/logout', logoutSettings)

// Authenticated monitoring/configuration
router.get('/stats', requireSettingsAuth, getStats)
router.get('/stats/history', requireSettingsAuth, getHistory)
router.get('/settings', requireSettingsAuth, getSettings)
router.patch('/settings', requireSettingsAuth, updateSettings)
router.post('/settings/generate-name', requireSettingsAuth, generateName)
router.get('/settings/name-history', requireSettingsAuth, getNameHistory)

// API Key Administration
router.post('/admin/keys/create', requireSettingsAuth, generateKey)
router.get('/admin/keys', requireSettingsAuth, getAllKeys)
router.delete('/admin/keys/:key', requireSettingsAuth, revokeKey)

// Main proxy route (requires proxy to be running)
const proxyRateLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 })
const proxyAuthMiddleware = require('../middleware/proxyAuth.middleware')

router.get('/search', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleSearch)
router.get('/v1/artist/lookup', proxyRateLimiter, proxyAuthMiddleware, proxyStateMiddleware, handleArtistLookup)

// Control routes
router.post('/proxy/start', startProxy)
router.post('/proxy/stop', stopProxy)
router.post('/cache/clear', clearCache)
router.post('/sync/trigger', triggerSync)

module.exports = router

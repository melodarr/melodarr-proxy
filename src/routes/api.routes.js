const express = require('express');
const router = express.Router();

const { getHealth } = require('../controllers/health.controller');
const { getStats } = require('../controllers/stats.controller');
const { handleArtistLookup, handleSearch } = require('../controllers/proxy.controller');
const { startProxy, stopProxy, clearCache, triggerSync } = require('../controllers/control.controller');
const {
  getSettings,
  getSettingsStatus,
  loginSettings,
  logoutSettings,
  requireSettingsAuth,
  setupSettings,
  updateSettings
} = require('../controllers/settings.controller');

const proxyStateMiddleware = require('../middleware/proxy.middleware');

// Public monitoring
router.get('/health', getHealth);
router.get('/settings/status', getSettingsStatus);
router.post('/settings/setup', setupSettings);
router.post('/settings/login', loginSettings);
router.post('/settings/logout', logoutSettings);

// Authenticated monitoring/configuration
router.get('/stats', requireSettingsAuth, getStats);
router.get('/settings', requireSettingsAuth, getSettings);
router.patch('/settings', requireSettingsAuth, updateSettings);

// Main proxy route (requires proxy to be running)
router.get('/search', proxyStateMiddleware, handleSearch);
router.get('/v1/artist/lookup', proxyStateMiddleware, handleArtistLookup);

// Control routes
router.post('/proxy/start', startProxy);
router.post('/proxy/stop', stopProxy);
router.post('/cache/clear', clearCache);
router.post('/sync/trigger', triggerSync);

module.exports = router;

const express = require('express')
const router = express.Router()

const { getRequests, getRequestById, getProviders, getCacheState, handleDebugDiscover, handleDebugSearch, handleDebugSongAlbums, getDiff, getPerformance, getAlerts, getHealth, verifyCache, getCluster, getClusterSummary, getOverview, testProviderConfig, diagnoseProvider, getUpstreamHistory, getProvidersDebug, getProvidersMetricsDebug, getMetrics } = require('../controllers/debug.controller')

router.get('/overview', getOverview)
router.get('/requests', getRequests)
router.get('/requests/:id', getRequestById)
router.get('/providers', getProviders)
// Live circuit-breaker + scoring snapshot. Distinct from /providers above
// (which returns the active-providers config list) — see getProvidersDebug.
router.get('/providers/health', getProvidersDebug)
// v0.3.40: side-by-side raw vs decayed metrics + computed score, for
// debugging the persistence + decay subsystem in production.
router.get('/providers/metrics', getProvidersMetricsDebug)
router.get('/metrics', getMetrics)
router.get('/cache', getCacheState)
router.get('/discover', handleDebugDiscover)
router.get('/song-albums', handleDebugSongAlbums)
router.get('/search', handleDebugSearch)
router.get('/diff', getDiff)
router.get('/performance', getPerformance)
router.get('/alerts', getAlerts)
router.get('/health', getHealth)
router.get('/verify-cache', verifyCache)
router.get('/cluster', getCluster)
router.get('/cluster/summary', getClusterSummary)
router.get('/diagnose', diagnoseProvider)
router.get('/upstream', getUpstreamHistory)
router.post('/test-provider', testProviderConfig)
module.exports = router

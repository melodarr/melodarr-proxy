const metrics = require('../metrics')
const cache = require('../cache')
const upstreamMonitor = require('../monitors/upstream.monitor')
const { getProviderScore } = require('../providers/scoring')
const { getAppVersion } = require('../utils/version')
const { buildNetworkHealthSummary } = require('../infrastructure/network/network-diagnostics.service')

const DEGRADED_UPSTREAM = new Set(['degraded', 'rate_limited', 'timeout'])

function buildLivenessPayload () {
  const memoryUsage = process.memoryUsage()
  const memoryMb = Math.round(memoryUsage.rss / 1024 / 1024)
  const memoryStatus = memoryMb > 500 ? 'critical' : (memoryMb > 300 ? 'warning' : 'ok')

  const cacheStatus = cache.getHealth()
  const providerScores = {}
  for (const [providerName] of metrics.providerStats.entries()) {
    providerScores[providerName] = getProviderScore(providerName, null)
  }

  return {
    status: memoryStatus === 'critical' ? 'down' : 'ok',
    service: process.env.APP_NAME || 'melodarr-proxy',
    version: getAppVersion(),
    instanceId: process.env.INSTANCE_ID,
    proxy: metrics.state.isRunning ? 'running' : 'stopped',
    memory: { status: memoryStatus, usageMb: memoryMb },
    uptime: process.uptime(),
    cache: cacheStatus,
    providers: providerScores,
    network: buildNetworkHealthSummary()
  }
}

function buildHealthPayload () {
  const upstream = upstreamMonitor.getStatus()
  const cacheStatus = cache.getHealth()
  const proxyStatus = metrics.state.isRunning ? 'running' : 'stopped'

  const memoryUsage = process.memoryUsage()
  const memoryMb = Math.round(memoryUsage.rss / 1024 / 1024)
  const memoryStatus = memoryMb > 500 ? 'critical' : (memoryMb > 300 ? 'warning' : 'ok')

  const upstreamDegraded = DEGRADED_UPSTREAM.has(upstream.status)
  const upstreamUnreachable = upstream.status === 'unreachable'
  const upstreamUnknown = upstream.status === 'unknown'
  const upstreamNotApplicable = upstream.status === 'not_applicable'
  const upstreamCountsAgainstReadiness = !upstreamNotApplicable

  let status = 'ok'
  if ((upstreamCountsAgainstReadiness && (upstreamDegraded || upstreamUnreachable || upstreamUnknown)) || cacheStatus === 'degraded' || proxyStatus === 'stopped' || memoryStatus === 'warning') {
    status = 'degraded'
  }
  if ((upstreamUnreachable && upstreamCountsAgainstReadiness && proxyStatus === 'stopped') || memoryStatus === 'critical') {
    status = 'down'
  }

  const providerScores = {}
  for (const [providerName] of metrics.providerStats.entries()) {
    providerScores[providerName] = getProviderScore(providerName, null)
  }

  return {
    status,
    service: process.env.APP_NAME || 'melodarr-proxy',
    version: getAppVersion(),
    instanceId: process.env.INSTANCE_ID,
    proxy: proxyStatus,
    upstream: upstream.status,
    upstreamDetail: {
      status: upstream.status,
      probedProvider: upstream.probedProvider,
      activeProviders: upstream.activeProviders,
      lastCheckedAt: upstream.lastCheckedAt,
      lastError: upstream.lastError,
      consecutiveFailures: upstream.consecutiveFailures
    },
    cache: cacheStatus,
    mode: cache.isRedisHealthy ? 'normal' : 'degraded',
    redisConnected: cache.isRedisHealthy,
    memory: { status: memoryStatus, usageMb: memoryMb },
    uptime: process.uptime(),
    lastQueryAt: metrics.state.lastQueryAt,
    providers: providerScores,
    network: buildNetworkHealthSummary()
  }
}

function getLiveness (req, res) {
  res.json(buildLivenessPayload())
}

function getReadiness (req, res) {
  const payload = buildHealthPayload()
  const code = payload.status === 'down' ? 503 : 200
  res.status(code).json(payload)
}

module.exports = { getLiveness, getReadiness, buildHealthPayload, buildLivenessPayload, getHealth: getLiveness }

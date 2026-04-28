const metrics = require('../metrics')
const cache = require('../cache')
const upstreamService = require('../services/upstream.service')
const { getProviderScore } = require('../providers/scoring')

async function buildHealthPayload () {
  const upstreamStatus = await upstreamService.checkHealth()
  const cacheStatus = cache.getHealth()
  const proxyStatus = metrics.state.isRunning ? 'running' : 'stopped'

  const memoryUsage = process.memoryUsage()
  const memoryMb = Math.round(memoryUsage.rss / 1024 / 1024)
  const memoryStatus = memoryMb > 500 ? 'critical' : (memoryMb > 300 ? 'warning' : 'ok')

  let status = 'ok'
  if (upstreamStatus === 'unreachable' || cacheStatus === 'degraded' || proxyStatus === 'stopped' || memoryStatus === 'warning') {
    status = 'degraded'
  }
  if ((upstreamStatus === 'unreachable' && proxyStatus === 'stopped') || memoryStatus === 'critical') {
    status = 'down'
  }

  const providerScores = {}
  for (const [providerName] of metrics.providerStats.entries()) {
    providerScores[providerName] = getProviderScore(providerName, null)
  }

  return {
    status,
    instanceId: process.env.INSTANCE_ID,
    proxy: proxyStatus,
    upstream: upstreamStatus,
    cache: cacheStatus,
    mode: cache.isRedisHealthy ? 'normal' : 'degraded',
    redisConnected: cache.isRedisHealthy,
    memory: {
      status: memoryStatus,
      usageMb: memoryMb
    },
    uptime: process.uptime(),
    lastQueryAt: metrics.state.lastQueryAt,
    providers: providerScores
  }
}

async function getHealth (req, res) {
  res.json(await buildHealthPayload())
}

module.exports = { getHealth, buildHealthPayload }

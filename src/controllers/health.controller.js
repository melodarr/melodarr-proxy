const metrics = require('../metrics')
const cache = require('../cache')
const upstreamService = require('../services/upstream.service')
const { getProviderScore } = require('../providers/scoring')

async function getHealth (req, res) {
  const upstreamStatus = await upstreamService.checkHealth()
  const cacheStatus = cache.getHealth()
  const proxyStatus = metrics.state.isRunning ? 'running' : 'stopped'

  // Deep memory diagnostic
  const memoryUsage = process.memoryUsage()
  const memoryMb = Math.round(memoryUsage.rss / 1024 / 1024)
  const memoryStatus = memoryMb > 500 ? 'critical' : (memoryMb > 300 ? 'warning' : 'ok')

  // Determine overall status
  let status = 'ok'
  if (upstreamStatus === 'unreachable' || cacheStatus === 'degraded' || proxyStatus === 'stopped' || memoryStatus === 'warning') {
    status = 'degraded'
  }
  if ((upstreamStatus === 'unreachable' && proxyStatus === 'stopped') || memoryStatus === 'critical') {
    status = 'down'
  }

  // Calculate provider scores (base score without data completeness for health check)
  const providerScores = {}
  for (const [providerName] of metrics.providerStats.entries()) {
    providerScores[providerName] = getProviderScore(providerName, null)
  }

  res.json({
    status,
    proxy: proxyStatus,
    upstream: upstreamStatus,
    cache: cacheStatus,
    memory: {
      status: memoryStatus,
      usageMb: memoryMb
    },
    uptime: process.uptime(),
    lastQueryAt: metrics.state.lastQueryAt,
    providers: providerScores
  })
}

module.exports = { getHealth }

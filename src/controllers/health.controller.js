const metrics = require('../metrics');
const cache = require('../cache');
const upstreamService = require('../services/upstream.service');

async function getHealth(req, res) {
  const upstreamStatus = await upstreamService.checkHealth();
  const cacheStatus = cache.getHealth();
  const proxyStatus = metrics.state.isRunning ? 'running' : 'stopped';

  // Determine overall status
  let status = 'ok';
  if (upstreamStatus === 'unreachable' || cacheStatus === 'degraded' || proxyStatus === 'stopped') {
    status = 'degraded';
  }
  if (upstreamStatus === 'unreachable' && proxyStatus === 'stopped') {
    status = 'down';
  }

  res.json({
    status,
    proxy: proxyStatus,
    upstream: upstreamStatus,
    cache: cacheStatus,
    uptime: process.uptime(),
    lastQueryAt: metrics.state.lastQueryAt
  });
}

module.exports = { getHealth };

const metrics = require('../metrics');
const cache = require('../cache');

function startProxy(req, res) {
  metrics.startProxy();
  res.json({ isRunning: true, message: 'Proxy started' });
}

function stopProxy(req, res) {
  metrics.stopProxy();
  res.json({ isRunning: false, message: 'Proxy stopped' });
}

async function clearCache(req, res) {
  await cache.clear();
  res.json({ message: 'Cache cleared successfully' });
}

function triggerSync(req, res) {
  console.log('[Control] Sync triggered');
  // Stub for sync functionality
  metrics.emit('sync_triggered'); // Update metrics or log
  res.json({ message: 'Sync triggered', timestamp: new Date().toISOString() });
}

module.exports = { startProxy, stopProxy, clearCache, triggerSync };

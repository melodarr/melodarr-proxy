const metrics = require('../metrics');
const cache = require('../cache');
const upstreamService = require('../services/upstream.service');

// Bonus: Track top queries and repeated queries
const queryCounts = new Map();

async function handleSearch(req, res) {
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter "q"' });
  }

  const cacheKey = `search:${q}`;

  // Check cache
  const cachedData = await cache.get(cacheKey);
  if (cachedData) {
    metrics.recordCache(true);
    return res.json(cachedData);
  }

  metrics.recordCache(false);

  try {
    const data = await upstreamService.search(q);
    
    // Bonus logic: Repeated queries get longer TTL
    let count = queryCounts.get(q) || 0;
    count++;
    queryCounts.set(q, count);
    
    let ttl = 86400; // 24h default
    if (count > 5) {
      ttl = 86400 * 3; // 3 days if queried many times
    }

    await cache.set(cacheKey, data, ttl);

    res.json(data);
  } catch (err) {
    console.error('[Proxy] Upstream error:', err.message);
    res.status(502).json({ error: 'Failed to fetch from upstream API' });
  }
}

module.exports = { handleSearch };

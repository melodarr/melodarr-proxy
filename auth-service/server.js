const http = require('http');

const PORT = process.env.PORT || 4000;
const startTime = Date.now();
const history = [];

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  // Contract: /api/health
  if (req.url === '/api/health' && req.method === 'GET') {
    const memoryUsage = process.memoryUsage();
    const memoryMb = Math.round(memoryUsage.rss / 1024 / 1024);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      proxy: 'running',
      upstream: 'ok',
      cache: 'ok',
      memory: {
        status: memoryMb > 300 ? 'warning' : 'ok',
        usageMb: memoryMb
      },
      uptime: process.uptime(),
      lastQueryAt: new Date().toISOString()
    }));
  }

  // Contract: /api/stats
  if (req.url === '/api/stats' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      startedAt: new Date(startTime).toISOString(),
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      requests: { total: 0, perMinute: 0 },
      cache: { hits: 0, misses: 0, hitRate: 0 },
      latency: { avgMs: 0, p95Ms: 0 },
      errors: { count: 0, rate: 0 },
      topQueries: []
    }));
  }

  // Contract: /api/stats/history
  if (req.url === '/api/stats/history' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      history: history
    }));
  }

  // Contract: /api/version
  if (req.url === '/api/version' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      app: process.env.APP_NAME || 'Auth Service',
      version: process.env.APP_VERSION || '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    }));
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// Mock history collection every minute
setInterval(() => {
  history.push({
    timestamp: new Date().toISOString(),
    requestsPerMinute: Math.floor(Math.random() * 5),
    latencyAvgMs: Math.floor(Math.random() * 10),
    errorRate: 0
  });
  if (history.length > 10) history.shift();
}, 60000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Auth Service running on port ${PORT}`);
});

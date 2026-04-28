const express = require('express');
const path = require('path');
const logger = require('./utils/logger');
const cacheLayer = require('./cache');
const upstreamService = require('./services/upstream.service');

// ── CLI Commands (run before server boots) ───────────────────────
if (process.argv.includes('--reset-password')) {
  const { resetPassword } = require('./settings/store');
  const result = resetPassword();

  if (result.cleared) {
    logger.info('Password cleared. The setup flow will appear on next login.', { context: 'CLI' });
  } else {
    logger.error(result.reason, { context: 'CLI' });
  }

  process.exit(0);
}

const metricsMiddleware = require('./middleware/metrics.middleware');
const apiRoutes = require('./routes/api.routes');
const { isAuthenticated } = require('./controllers/settings.controller');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
// Custom CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});
app.use(express.json());

// Metrics tracking for all routes
app.use(metricsMiddleware);

function isProtectedPage(req) {
  return req.method === 'GET' && (req.path === '/' || (req.path.endsWith('.html') && req.path !== '/login.html'));
}

app.use((req, res, next) => {
  if (req.method === 'GET' && req.path === '/login.html' && isAuthenticated(req)) {
    return res.redirect('/');
  }

  if (isProtectedPage(req) && !isAuthenticated(req)) {
    return res.redirect('/login.html');
  }

  return next();
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../public')));

// Versioning + Release Identity Endpoint
app.get('/api/version', (req, res) => {
  res.json({
    app: process.env.APP_NAME || 'Melodarr Proxy',
    version: process.env.APP_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes
app.use('/api', apiRoutes);
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'API route not found'
  });
});

// Fallback for SPA or unmatched routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Startup Validation (Fail-Fast System) ───────────────────────
async function boot() {
  logger.info('Starting boot sequence...');
  
  // 1. Verify required environment variables
  const requiredEnv = ['UPSTREAM_URL'];
  const missing = requiredEnv.filter(env => !process.env[env]);
  if (missing.length > 0) {
    logger.error(`Boot failed: Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  // 2. Validate Cache Connection
  try {
    const isCacheConnected = await cacheLayer.isReady();
    if (isCacheConnected) {
      logger.info('Cache connection validated.');
    } else {
      logger.warn('Redis cache is not connected. Will fallback to in-memory caching.');
    }
  } catch (err) {
    logger.warn('Failed to validate cache connection.', { error: err.message });
  }

  // 3. Validate Upstream Connectivity
  try {
    const upstreamHealth = await upstreamService.checkHealth();
    if (!upstreamHealth) {
      throw new Error('Upstream API is unreachable.');
    }
    logger.info('Upstream connectivity validated.');
  } catch (err) {
    logger.error('Boot failed: Upstream validation error.', { error: err.message });
    process.exit(1);
  }

  // Start server
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Production proxy running on port ${PORT}`);
    logger.info(`Health Check: http://localhost:${PORT}/api/health`);
  });
}

boot();

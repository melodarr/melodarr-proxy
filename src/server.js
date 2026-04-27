const express = require('express');
const path = require('path');

// ── CLI Commands (run before server boots) ───────────────────────
if (process.argv.includes('--reset-password')) {
  const { resetPassword } = require('./settings/store');
  const result = resetPassword();

  if (result.cleared) {
    console.log('[CLI] Password cleared. The setup flow will appear on next login.');
  } else {
    console.log(`[CLI] ${result.reason}`);
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

// API Routes
app.use('/api', apiRoutes);

// Fallback for SPA or unmatched routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`[Server] Production proxy running on port ${PORT}`);
  console.log(`[Server] Health Check: http://localhost:${PORT}/api/health`);
});

const metrics = require('../metrics');

function proxyStateMiddleware(req, res, next) {
  if (!metrics.state.isRunning) {
    return res.status(503).json({ error: 'Proxy is currently stopped' });
  }
  next();
}

module.exports = proxyStateMiddleware;

const apiKeyMiddleware = require('./apiKey.middleware')
const externalAuthMiddleware = require('./auth.middleware')
const { isAuthenticated } = require('../controllers/settings.controller')

function proxyAuthMiddleware (req, res, next) {
  if (process.env.AUTH_ENABLED === 'true') {
    return externalAuthMiddleware(req, res, next)
  }

  if (isAuthenticated(req)) {
    return next()
  }

  return apiKeyMiddleware(req, res, next)
}

module.exports = proxyAuthMiddleware

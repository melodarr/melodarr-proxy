const apiKeyMiddleware = require('./apiKey.middleware')
const { isAuthenticated } = require('../controllers/settings.controller')

function proxyAuthMiddleware (req, res, next) {
  if (isAuthenticated(req)) {
    return next()
  }

  return apiKeyMiddleware(req, res, next)
}

module.exports = proxyAuthMiddleware

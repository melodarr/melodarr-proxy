const logger = require('../utils/logger')

async function authMiddleware (req, res, next) {
  if (process.env.AUTH_ENABLED !== 'true') {
    return next()
  }

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Auth denied: Missing or invalid authorization header')
    return res.status(401).json({ error: 'Missing or invalid authorization header' })
  }

  try {
    const authUrl = process.env.AUTH_URL || 'http://auth:4000/api/auth/validate'
    const response = await fetch(authUrl, {
      method: 'GET',
      headers: {
        Authorization: authHeader
      }
    })

    if (!response.ok) {
      logger.warn('Auth denied: Token validation failed upstream')
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    const data = await response.json()
    if (data.valid) {
      req.user = data.user
      return next()
    } else {
      return res.status(401).json({ error: 'Invalid token' })
    }
  } catch (err) {
    logger.error('Auth Service unreachable', { error: err.message })
    return res.status(503).json({ error: 'Auth service unavailable' })
  }
}

module.exports = authMiddleware

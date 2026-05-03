const DEFAULT_ALLOWED_HEADERS = 'Content-Type, Authorization, Content-Length, X-Requested-With, X-Api-Key, X-CSRF-Token'
const DEFAULT_ALLOWED_METHODS = 'GET,PUT,PATCH,POST,DELETE,OPTIONS'

const OPERATOR_PATH_RE = /^(?:\/api\/(?:admin|cache|proxy|settings|stats|sync|update\/apply)(?:\/|$)|\/debug(?:\/|$)|\/(?:dashboard|login|settings|stats)(?:\/|$))/

function parseAllowedOrigins (value = '') {
  return String(value)
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
}

function getRequestOrigin (req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return host ? `${protocol}://${host}` : ''
}

function isSameOrigin (req, origin) {
  return Boolean(origin && getRequestOrigin(req) === origin)
}

function isOperatorPath (path = '') {
  return OPERATOR_PATH_RE.test(path)
}

function isAllowedOperatorOrigin (req, origin, allowedOrigins) {
  return isSameOrigin(req, origin) || allowedOrigins.includes(origin)
}

function corsMiddleware (req, res, next) {
  const origin = req.headers.origin
  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || '')
  const operatorPath = isOperatorPath(req.path || req.url || '')

  res.header('Access-Control-Allow-Methods', DEFAULT_ALLOWED_METHODS)
  res.header('Access-Control-Allow-Headers', DEFAULT_ALLOWED_HEADERS)

  if (operatorPath) {
    if (origin && isAllowedOperatorOrigin(req, origin, allowedOrigins)) {
      res.header('Access-Control-Allow-Origin', origin)
      res.header('Access-Control-Allow-Credentials', 'true')
      res.header('Vary', 'Origin')
    } else if (origin && req.method === 'OPTIONS') {
      return res.sendStatus(403)
    }
  } else {
    res.header('Access-Control-Allow-Origin', '*')
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200)
  }

  return next()
}

module.exports = corsMiddleware
module.exports.isOperatorPath = isOperatorPath
module.exports.parseAllowedOrigins = parseAllowedOrigins

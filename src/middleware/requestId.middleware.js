const crypto = require('crypto')
const requestContext = require('../utils/request-context')

// Honored X-Request-Id values must be safe for logs, URLs, and headers.
// Allow hex, UUID, and base64url alphabets up to 64 chars. Anything else is
// ignored and we generate our own — never mutate or namespace a valid value.
const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/

function validateOrGenerate (headerValue) {
  if (typeof headerValue === 'string' && VALID_REQUEST_ID.test(headerValue)) {
    return headerValue
  }
  return crypto.randomBytes(8).toString('hex')
}

function requestIdMiddleware (req, res, next) {
  const provided = req.headers['x-request-id']
  const requestId = validateOrGenerate(provided)
  req.requestId = requestId
  res.setHeader('X-Request-Id', requestId)
  // Wrap the rest of the handler chain in an ALS scope. Any async work that
  // happens via Promises / setTimeout / setImmediate inherits this context.
  requestContext.run({ requestId }, () => next())
}

module.exports = requestIdMiddleware
module.exports.validateOrGenerate = validateOrGenerate
module.exports.VALID_REQUEST_ID = VALID_REQUEST_ID

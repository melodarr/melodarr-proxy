const requestContext = require('./request-context')

const formatMessage = (level, message, meta = {}) => {
  if (meta instanceof Error) {
    meta = {
      name: meta.name,
      message: meta.message,
      stack: meta.stack,
      code: meta.code,
      cause: meta.cause ? (meta.cause instanceof Error ? meta.cause.message : meta.cause) : undefined
    }
  } else if (meta.error instanceof Error) {
    meta.error = {
      name: meta.error.name,
      message: meta.error.message,
      stack: meta.error.stack,
      code: meta.error.code,
      cause: meta.error.cause ? (meta.error.cause instanceof Error ? meta.error.cause.message : meta.error.cause) : undefined
    }
  }

  // Auto-inject the inbound requestId from ALS so every log line emitted
  // within an HTTP request scope is greppable by request. Outside an ALS
  // scope (boot, monitor, scheduled jobs) the field is omitted.
  const requestId = requestContext.getRequestId()

  const logObj = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    ...(requestId ? { requestId } : {}),
    message,
    ...meta
  }

  // Safe stringify to handle circular references in axios errors
  const cache = new Set()
  return JSON.stringify(logObj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (cache.has(value)) return '[Circular]'
      cache.add(value)
    }
    return value
  })
}

const logger = {
  info: (message, meta) => console.log(formatMessage('info', message, meta)),
  warn: (message, meta) => console.warn(formatMessage('warn', message, meta)),
  error: (message, meta) => console.error(formatMessage('error', message, meta)),
  debug: (message, meta) => {
    if (process.env.DEBUG) {
      console.debug(formatMessage('debug', message, meta))
    }
  }
}

module.exports = logger

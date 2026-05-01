// Fire-and-forget shadow execution.
//
// Calls a provider function without awaiting it, so the caller's response
// path is never delayed or affected. Used to:
//   - exercise newly-added providers against real traffic without
//     trusting their output yet
//   - keep otherwise-disabled providers warm without coupling them to
//     the user-facing response
//
// Errors are caught and logged at INFO; they MUST never propagate to
// the caller, since by definition the caller did not await this call.

const logger = require('../utils/logger')

function shadowCall (name, fn, query) {
  const start = Date.now()
  // Wrap in Promise.resolve so a synchronous throw inside fn is also
  // converted to a rejected promise — never escapes this function.
  Promise.resolve()
    .then(() => fn(query))
    .then((result) => {
      const length = Array.isArray(result) ? result.length : (result ? 1 : 0)
      logger.info('Shadow call ok', {
        provider: name,
        success: true,
        latencyMs: Date.now() - start,
        length
      })
    })
    .catch((err) => {
      logger.info('Shadow call failed', {
        provider: name,
        success: false,
        latencyMs: Date.now() - start,
        error: err && err.message ? err.message : String(err)
      })
    })
}

module.exports = { shadowCall }

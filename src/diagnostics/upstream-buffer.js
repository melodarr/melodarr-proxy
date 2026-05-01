// In-memory ring buffer of upstream attempt outcomes. One entry per HTTP
// attempt (success or failure), so 3 retries = 3 entries that share a
// requestId. Pure observability — never blocks the hot path. Fixed size
// (default 100); oldest entries are evicted FIFO.

const MAX_DEFAULT = 100

const state = {
  entries: [],
  maxSize: MAX_DEFAULT
}

function record (entry) {
  state.entries.push(entry)
  while (state.entries.length > state.maxSize) state.entries.shift()
}

function query ({ provider, requestId, limit } = {}) {
  let filtered = state.entries
  if (provider) {
    const target = String(provider).toLowerCase()
    filtered = filtered.filter((e) => e.provider === target)
  }
  if (requestId) {
    filtered = filtered.filter((e) => e.requestId === requestId)
  }
  const filteredCount = filtered.length
  const reversed = filtered.slice().reverse()
  const sliced = typeof limit === 'number' && limit > 0 ? reversed.slice(0, limit) : reversed
  return {
    entries: sliced,
    filteredCount,
    totalCount: state.entries.length,
    maxSize: state.maxSize
  }
}

function clear () {
  state.entries = []
}

function setMaxSize (size) {
  if (!Number.isFinite(size) || size <= 0) return
  state.maxSize = Math.floor(size)
  while (state.entries.length > state.maxSize) state.entries.shift()
}

const DNS_ERRORS = new Set(['EAI_AGAIN', 'ENOTFOUND', 'EAI_NODATA', 'EAI_FAIL'])
const TCP_ERRORS = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL'])
// ECONNRESET classically signals TLS handshake reset against the upstream
// the operator is probably hitting. It can also happen mid-HTTP, but the
// MB failure mode in this codebase is consistently TLS-phase ECONNRESET,
// so this is the best-guess classification operators want to see.
const TLS_ERRORS = new Set(['ECONNRESET', 'EPROTO', 'ERR_SSL_PROTOCOL_ERROR', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED'])

function classifyFailedStep ({ error, status } = {}) {
  if (!error) {
    if (typeof status === 'number') {
      return status >= 200 && status < 300 ? null : 'http'
    }
    return null
  }
  const code = error.code
  if (code && DNS_ERRORS.has(code)) return 'dns'
  if (code && TCP_ERRORS.has(code)) return 'tcp'
  if (code && TLS_ERRORS.has(code)) return 'tls'
  // axios maps timeouts to ECONNABORTED; underlying socket timeouts to
  // ETIMEDOUT. Without per-phase timing we can't distinguish TCP-connect
  // timeout from TLS-handshake timeout from response timeout — fall back
  // to "http" so the raw error.code is still visible to operators.
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'http'
  if (typeof status === 'number') return 'http'
  return 'http'
}

module.exports = { record, query, clear, setMaxSize, classifyFailedStep, MAX_DEFAULT }

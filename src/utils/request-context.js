// Per-request context carried through the async stack via AsyncLocalStorage.
// The HTTP middleware sets { requestId } at the top of every inbound request;
// downstream code (logger, providers, tracer, ring buffer) reads the requestId
// without needing it threaded through every function signature.
//
// Direct (non-inbound) callers — boot probe, monitor, diagnose endpoint — are
// outside any ALS scope and getRequestId() returns null. Those callers
// generate their own ids locally so observability still groups their attempts.

const { AsyncLocalStorage } = require('async_hooks')

const als = new AsyncLocalStorage()

function run (context, fn) {
  return als.run(context, fn)
}

function getStore () {
  return als.getStore() || null
}

function getRequestId () {
  const store = als.getStore()
  return store?.requestId || null
}

module.exports = { als, run, getStore, getRequestId }

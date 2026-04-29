const crypto = require('crypto')
const cache = require('../cache')

const SNAPSHOT_PREFIX = 'snapshot:'

function hashData (data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')
}

async function saveSnapshot (query, data) {
  const key = `${SNAPSHOT_PREFIX}${query}`
  const current = await cache.get(key)

  let history = []
  if (current) {
    history = Array.isArray(current) ? current : [current]
  }

  const normalizedHash = hashData(data)

  // 7. Diff optimization: Compare hashes first
  if (history.length > 0 && history[0].normalized_hash === normalizedHash) {
    // Exact same data, just update timestamp
    history[0].timestamp = new Date().toISOString()
  } else {
    // 3. Snapshot Optimization: Store latest + previous request per query
    history.unshift({
      timestamp: new Date().toISOString(),
      normalized_hash: normalizedHash,
      data
    })
    if (history.length > 2) {
      history = history.slice(0, 2)
    }
  }

  // 8. Config-driven retention (can use an env var, default 7 days)
  const ttl = parseInt(process.env.SNAPSHOT_TTL_SECONDS || '604800', 10)
  await cache.set(key, history, ttl)
}

async function getSnapshots (query) {
  const key = `${SNAPSHOT_PREFIX}${query}`
  const history = await cache.get(key)
  return Array.isArray(history) ? history : []
}

module.exports = { saveSnapshot, getSnapshots, hashData }

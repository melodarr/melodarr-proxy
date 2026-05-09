const metrics = require('../metrics')

function getProviderScore (providerName, resultData) {
  // 1. Success Rate & Latency
  let successRate = 1
  let latencyMs = 0

  const pStats = metrics.providerStats.get(providerName)
  if (pStats && pStats.calls > 0) {
    successRate = 1 - (pStats.errors / pStats.calls)
    latencyMs = Math.round(pStats.totalLatency / pStats.calls)
  }

  // 2. Latency (Normalized: 0ms = 1, >=2000ms = 0)
  const maxExpectedLatency = 2000
  let normalizedLatency = latencyMs / maxExpectedLatency
  if (normalizedLatency > 1) normalizedLatency = 1

  // 3. Data Completeness
  let dataCompleteness = 0
  if (resultData && resultData.albums && resultData.albums.length > 0) {
    const albumsWithYear = resultData.albums.filter(a => !!a.year).length
    dataCompleteness = albumsWithYear / resultData.albums.length
  }

  // Calculate base score (0 to 1)
  const score = (successRate * 0.4) + (dataCompleteness * 0.4) + ((1 - normalizedLatency) * 0.2)

  return Math.min(Math.round(score * 100), 100)
}

module.exports = { getProviderScore }

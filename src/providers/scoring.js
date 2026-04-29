const metrics = require('../metrics')
const settingsStore = require('../settings/store')

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
  let score = (successRate * 0.4) + (dataCompleteness * 0.4) + ((1 - normalizedLatency) * 0.2)

  // Apply priority multiplier (optional configured priority)
  const priorityConfig = settingsStore.getConfigValue('providerPriority') || ''
  if (priorityConfig) {
    const priorities = priorityConfig.split(',').map(s => s.trim().toLowerCase())
    const pIndex = priorities.indexOf(providerName)

    if (pIndex !== -1) {
      // Boost based on priority position: e.g., first gets 1.2x, second 1.1x, etc.
      const boost = 1 + ((priorities.length - pIndex) * 0.1)
      score = score * boost
    }
  }

  return Math.min(Math.round(score * 100), 100)
}

module.exports = { getProviderScore }

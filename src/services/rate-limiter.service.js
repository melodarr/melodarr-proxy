const { getConfigValue } = require('../settings/store')
const { parseRetryAfter } = require('./retry-policy')

const queues = new Map()

function getPositiveInterval (key) {
  const value = getConfigValue(key)
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function getProviderMinRequestIntervalMs (name) {
  let key
  switch (name) {
    case 'itunes': key = 'itunesMinRequestIntervalMs'; break
    case 'lastfm': key = 'lastfmMinRequestIntervalMs'; break
    case 'discogs': key = 'discogsMinRequestIntervalMs'; break
    case 'theaudiodb': key = 'theAudioDbMinRequestIntervalMs'; break
    case 'musicbrainz': key = 'minRequestIntervalMs'; break
    default: {
      let customProviders = []
      try {
        const rawConfig = getConfigValue('customProviders')
        customProviders = typeof rawConfig === 'string' ? JSON.parse(rawConfig || '[]') : (rawConfig || [])
      } catch (err) {
        // Ignored
      }
      const customConfig = customProviders.find(p => p.id === name)
      if (customConfig && typeof customConfig.minRequestIntervalMs === 'number' && Number.isFinite(customConfig.minRequestIntervalMs) && customConfig.minRequestIntervalMs >= 0) {
        return customConfig.minRequestIntervalMs
      }
      key = 'customProviderMinRequestIntervalMs'
      break
    }
  }

  if (name === 'musicbrainz') {
    return getPositiveInterval(key) ?? 1100
  }

  const defaultInterval = getPositiveInterval('providerMinRequestIntervalMs') ?? 500
  return getPositiveInterval(key) ?? defaultInterval
}

function getQueueState (name) {
  if (!queues.has(name)) {
    queues.set(name, {
      lastRequestTime: 0,
      activeRequests: 0,
      waitingQueue: [],
      isProcessing: false,
      pausedUntil: 0
    })
  }
  return queues.get(name)
}

async function processQueue (name, state) {
  if (state.isProcessing) return
  state.isProcessing = true

  try {
    const minInterval = getProviderMinRequestIntervalMs(name)
    // Concurrency limits: MusicBrainz strict 1, others maybe 3.
    // To strictly follow rules, we should ensure only 1 request per provider is initiated per interval.
    const maxConcurrency = name === 'musicbrainz' ? 1 : (getConfigValue('maxConcurrentRequests') || 20)

    while (state.waitingQueue.length > 0 && state.activeRequests < maxConcurrency) {
      const now = Date.now()

      if (state.pausedUntil > now) {
        await new Promise(resolve => setTimeout(resolve, state.pausedUntil - now))
        continue
      }

      const timeSinceLast = now - state.lastRequestTime

      if (timeSinceLast < minInterval) {
        await new Promise(resolve => setTimeout(resolve, minInterval - timeSinceLast))
        continue
      }

      if (state.waitingQueue.length === 0 || state.activeRequests >= maxConcurrency) {
        break
      }

      const task = state.waitingQueue.shift()
      state.lastRequestTime = Date.now()
      state.activeRequests++

      task().finally(() => {
        state.activeRequests--
        processQueue(name, state)
      })
    }
  } finally {
    state.isProcessing = false
  }
}

async function enqueueProviderRequest (name, fn) {
  const state = getQueueState(name)
  const queueMax = getConfigValue('upstreamQueueMax') || 50

  if (state.waitingQueue.length >= queueMax) {
    const err = new Error(`Provider ${name} request queue is full`)
    err.code = 'PROVIDER_QUEUE_FULL'
    err.status = 503
    return Promise.reject(err)
  }

  return new Promise((resolve, reject) => {
    const task = async () => {
      try {
        const result = await fn()
        resolve(result)
      } catch (err) {
        const status = err.response?.status
        if (status === 429 || status === 503) {
          const retryAfterHeader = err.response?.headers?.['retry-after']
          let pauseMs = 5000 // default penalty if no header
          if (retryAfterHeader) {
            const parsed = parseRetryAfter(retryAfterHeader)
            if (parsed !== null && parsed > 0) pauseMs = parsed
          }
          const pauseTime = Date.now() + pauseMs
          if (pauseTime > state.pausedUntil) state.pausedUntil = pauseTime
        }
        reject(err)
      }
    }
    state.waitingQueue.push(task)
    processQueue(name, state)
  })
}

module.exports = {
  enqueueProviderRequest,
  getProviderMinRequestIntervalMs
}

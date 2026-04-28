const totalRequestsEl = document.querySelector('#total-requests')
const artistLookupsEl = document.querySelector('#artist-lookups')
const cacheHitRateEl = document.querySelector('#cache-hit-rate')
const upstreamCallsEl = document.querySelector('#upstream-calls')
const uptimeEl = document.querySelector('#uptime')
const statsGrid = document.querySelector('#stats-grid')
const lastLookupHeading = document.querySelector('#last-lookup-heading')
const lastLookupEl = document.querySelector('#last-lookup')
const statusEl = document.querySelector('#status')
const refreshButton = document.querySelector('#refresh')

function setStatus (message, isError = false) {
  statusEl.textContent = message
  statusEl.style.color = isError ? '#b42318' : '#44505c'
}

function formatNumber (value) {
  return typeof value === 'number' ? value.toLocaleString() : '-'
}

function formatPercent (value) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '-'
}

function formatDuration (seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`
  }

  return `${remainingSeconds}s`
}

function createMetricSection (title, values) {
  const section = document.createElement('section')
  const heading = document.createElement('h3')
  const list = document.createElement('dl')

  heading.textContent = title

  Object.entries(values).forEach(([key, value]) => {
    const term = document.createElement('dt')
    const definition = document.createElement('dd')

    term.textContent = key
    definition.textContent = String(value)
    list.append(term, definition)
  })

  section.append(heading, list)
  return section
}

function renderProviderStats (providers) {
  const entries = Object.entries(providers || {})

  if (entries.length === 0) {
    return createMetricSection('Providers', {
      status: 'No provider calls recorded'
    })
  }

  const section = document.createElement('section')
  const heading = document.createElement('h3')
  const list = document.createElement('dl')

  heading.textContent = 'Providers'

  entries.forEach(([name, provider]) => {
    const term = document.createElement('dt')
    const definition = document.createElement('dd')

    term.textContent = name
    definition.textContent = `${provider.calls || 0} calls; ${provider.errors || 0} errors; avg ${provider.avgLatencyMs || 0}ms`
    list.append(term, definition)
  })

  section.append(heading, list)
  return section
}

function renderStats (stats) {
  const requests = stats.requests || {}
  const cache = stats.cache || {}
  const artistLookup = stats.artistLookup || {}
  const errors = stats.errors || {}
  const latency = stats.latency || {}
  const providers = stats.providers || {}
  const cacheHitRate = artistLookup.cacheHitRate ?? cache.hitRate

  totalRequestsEl.textContent = formatNumber(requests.total)
  artistLookupsEl.textContent = formatNumber(artistLookup.total)
  cacheHitRateEl.textContent = formatPercent(cacheHitRate)
  upstreamCallsEl.textContent = formatNumber(artistLookup.upstreamCalls)
  uptimeEl.textContent = stats.startedAt
    ? `Started ${stats.startedAt}; uptime ${formatDuration(stats.uptimeSeconds || 0)}`
    : 'Runtime stats are active'

  statsGrid.replaceChildren(
    createMetricSection('Requests', {
      total: requests.total ?? 0,
      perMinute: requests.perMinute ?? 0
    }),
    createMetricSection('Artist lookup', {
      total: artistLookup.total ?? 0,
      cacheHits: artistLookup.cacheHits ?? cache.hits ?? 0,
      cacheMisses: artistLookup.cacheMisses ?? cache.misses ?? 0,
      upstreamCalls: artistLookup.upstreamCalls ?? 0,
      partialResponses: artistLookup.partialResponses ?? 0
    }),
    createMetricSection('Latency', {
      avgMs: latency.avgMs ?? 0,
      p95Ms: latency.p95Ms ?? 0
    }),
    createMetricSection('Errors', {
      count: errors.count ?? 0,
      rate: formatPercent(errors.rate)
    }),
    renderProviderStats(providers)
  )

  lastLookupHeading.textContent = artistLookup.lastLookup?.term || 'No lookup recorded'
  lastLookupEl.textContent = JSON.stringify(artistLookup.lastLookup || {}, null, 2)
}

async function loadStats () {
  setStatus('Loading stats...')
  const response = await fetch('/api/stats')
  const stats = await response.json()

  if (response.status === 401) {
    window.location.assign('/login.html')
    return
  }

  if (!response.ok) {
    throw new Error(stats.error || 'Unable to load stats')
  }

  renderStats(stats)
  setStatus('Stats loaded')
}

refreshButton.addEventListener('click', () => {
  loadStats().catch((error) => {
    setStatus(error.message, true)
  })
})

loadStats().catch((error) => {
  setStatus(error.message, true)
})

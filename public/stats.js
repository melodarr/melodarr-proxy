const totalRequestsEl = document.querySelector('#total-requests');
const artistLookupsEl = document.querySelector('#artist-lookups');
const cacheHitRateEl = document.querySelector('#cache-hit-rate');
const upstreamCallsEl = document.querySelector('#upstream-calls');
const uptimeEl = document.querySelector('#uptime');
const statsGrid = document.querySelector('#stats-grid');
const lastLookupHeading = document.querySelector('#last-lookup-heading');
const lastLookupEl = document.querySelector('#last-lookup');
const statusEl = document.querySelector('#status');
const refreshButton = document.querySelector('#refresh');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b42318' : '#44505c';
}

function formatNumber(value) {
  return typeof value === 'number' ? value.toLocaleString() : '-';
}

function formatPercent(value) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '-';
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}

function createMetricSection(title, values) {
  const section = document.createElement('section');
  const heading = document.createElement('h3');
  const list = document.createElement('dl');

  heading.textContent = title;

  Object.entries(values).forEach(([key, value]) => {
    const term = document.createElement('dt');
    const definition = document.createElement('dd');

    term.textContent = key;
    definition.textContent = String(value);
    list.append(term, definition);
  });

  section.append(heading, list);
  return section;
}

function renderStats(stats) {
  totalRequestsEl.textContent = formatNumber(stats.requests.total);
  artistLookupsEl.textContent = formatNumber(stats.artistLookup.total);
  cacheHitRateEl.textContent = formatPercent(stats.artistLookup.cacheHitRate);
  upstreamCallsEl.textContent = formatNumber(stats.artistLookup.upstreamCalls);
  uptimeEl.textContent = `Started ${stats.startedAt}; uptime ${formatDuration(stats.uptimeSeconds)}`;

  statsGrid.replaceChildren(
    createMetricSection('Requests', {
      total: stats.requests.total,
      slow: stats.requests.slow
    }),
    createMetricSection('Artist lookup', {
      total: stats.artistLookup.total,
      cacheHits: stats.artistLookup.cacheHits,
      cacheMisses: stats.artistLookup.cacheMisses,
      partialResponses: stats.artistLookup.partialResponses,
      errors: stats.artistLookup.errors
    }),
    createMetricSection('Status codes', stats.requests.byStatus),
    createMetricSection('Routes', stats.requests.byRoute)
  );

  lastLookupHeading.textContent = stats.artistLookup.lastLookup?.term || 'No lookup recorded';
  lastLookupEl.textContent = JSON.stringify(stats.artistLookup.lastLookup || {}, null, 2);
}

async function loadStats() {
  setStatus('Loading stats...');
  const response = await fetch('/api/stats');
  const stats = await response.json();

  if (response.status === 401) {
    window.location.assign('/login.html');
    return;
  }

  if (!response.ok) {
    throw new Error(stats.error || 'Unable to load stats');
  }

  renderStats(stats);
  setStatus('Stats loaded');
}

refreshButton.addEventListener('click', () => {
  loadStats().catch((error) => {
    setStatus(error.message, true);
  });
});

loadStats().catch((error) => {
  setStatus(error.message, true);
});

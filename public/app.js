const form = document.querySelector('#lookup-form')
const termInput = document.querySelector('#term')
const statusEl = document.querySelector('#status')
const cacheEl = document.querySelector('#cache')
const upstreamEl = document.querySelector('#upstream')
const providersEl = document.querySelector('#providers')
const durationEl = document.querySelector('#duration')
const albumCountEl = document.querySelector('#album-count')
const artistNameEl = document.querySelector('#artist-name')
const artistIdEl = document.querySelector('#artist-id')
const albumsEl = document.querySelector('#albums')
const jsonEl = document.querySelector('#json')
const toggleJsonButton = document.querySelector('#toggle-json')

function setStatus (message, tone = 'neutral') {
  statusEl.textContent = message
  statusEl.dataset.tone = tone
}

function renderAlbums (albums) {
  albumsEl.replaceChildren(
    ...albums.map((album) => {
      const row = document.createElement('tr')
      const artwork = document.createElement('td')
      const title = document.createElement('td')
      const date = document.createElement('td')
      const id = document.createElement('td')
      const provider = document.createElement('td')
      const code = document.createElement('code')

      if (album.coverUrl) {
        const img = document.createElement('img')
        img.src = album.coverUrl
        img.alt = ''
        img.className = 'album-artwork'
        img.loading = 'lazy'
        artwork.append(img)
      } else {
        artwork.textContent = '-'
      }

      title.textContent = album.title || '-'
      date.textContent = album.firstReleaseDate || '-'
      code.textContent = album.id || '-'
      provider.textContent = album.provider || '-'
      id.append(code)
      row.append(artwork, title, date, id, provider)
      return row
    })
  )
}

async function lookupArtist (term) {
  const startedAt = performance.now()
  const response = await fetch(`/api/v1/artist/lookup?term=${encodeURIComponent(term)}`)
  const duration = Math.round(performance.now() - startedAt)
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.warning || data.error || `Request failed with status ${response.status}`)
  }

  cacheEl.textContent = response.headers.get('X-Cache') || '-'
  upstreamEl.textContent = response.headers.get('X-Upstream-Calls') || '0'
  providersEl.textContent = data.providers?.map(provider => provider.name).join(', ') || response.headers.get('X-Providers') || '-'
  durationEl.textContent = `${duration}ms`
  albumCountEl.textContent = String(data.albums?.length || 0)
  artistNameEl.textContent = data.artistName || 'Unknown artist'
  artistIdEl.textContent = data.foreignArtistId || '-'
  jsonEl.textContent = JSON.stringify(data, null, 2)
  renderAlbums(data.albums || [])

  if (data.partial) {
    setStatus('Lookup complete with provider warnings', 'warning')
  } else {
    setStatus('Lookup complete', 'success')
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const term = termInput.value.trim()
  const button = form.querySelector('button')

  if (!term) {
    return
  }

  button.disabled = true
  setStatus('Searching...')

  try {
    await lookupArtist(term)
  } catch (error) {
    setStatus(error.message, 'error')
  } finally {
    button.disabled = false
  }
})

toggleJsonButton.addEventListener('click', () => {
  jsonEl.hidden = !jsonEl.hidden
})

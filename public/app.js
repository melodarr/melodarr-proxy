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
  if (!albums || albums.length === 0) {
    const section = document.createElement('section')
    section.textContent = 'No items returned'
    section.style.textAlign = 'center'
    section.style.color = 'var(--text-tertiary)'
    section.style.gridColumn = '1 / -1'
    albumsEl.replaceChildren(section)
    return
  }

  albumsEl.replaceChildren(
    ...albums.map((album) => {
      const section = document.createElement('section')

      const header = document.createElement('div')
      header.style.display = 'flex'
      header.style.alignItems = 'center'
      header.style.gap = 'var(--space-md)'
      header.style.marginBottom = 'var(--space-lg)'
      header.style.paddingBottom = 'var(--space-sm)'
      header.style.borderBottom = '1px solid var(--border-subtle)'

      if (album.coverUrl) {
        const img = document.createElement('img')
        img.src = album.coverUrl
        img.alt = ''
        img.className = 'album-artwork'
        img.loading = 'lazy'
        header.append(img)
      }

      const title = document.createElement('h3')
      title.textContent = album.title || '-'
      title.style.margin = '0'
      title.style.borderBottom = 'none'
      title.style.paddingBottom = '0'
      title.style.flex = '1'

      header.append(title)
      section.append(header)

      const dl = document.createElement('dl')

      const createRow = (label, value) => {
        const dt = document.createElement('dt')
        dt.textContent = label
        const dd = document.createElement('dd')
        dd.textContent = value
        dl.append(dt, dd)
      }

      createRow('Date', album.firstReleaseDate || '-')
      createRow('ID', album.id || '-')
      createRow('Provider', album.provider || '-')

      section.append(dl)
      return section
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

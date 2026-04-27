const form = document.querySelector('#lookup-form');
const termInput = document.querySelector('#term');
const statusEl = document.querySelector('#status');
const cacheEl = document.querySelector('#cache');
const upstreamEl = document.querySelector('#upstream');
const durationEl = document.querySelector('#duration');
const albumCountEl = document.querySelector('#album-count');
const artistNameEl = document.querySelector('#artist-name');
const artistIdEl = document.querySelector('#artist-id');
const albumsEl = document.querySelector('#albums');
const jsonEl = document.querySelector('#json');
const toggleJsonButton = document.querySelector('#toggle-json');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b42318' : '#44505c';
}

function renderAlbums(albums) {
  albumsEl.replaceChildren(
    ...albums.map((album) => {
      const row = document.createElement('tr');
      const title = document.createElement('td');
      const date = document.createElement('td');
      const id = document.createElement('td');
      const code = document.createElement('code');

      title.textContent = album.title || '-';
      date.textContent = album.firstReleaseDate || '-';
      code.textContent = album.id || '-';
      id.append(code);
      row.append(title, date, id);
      return row;
    })
  );
}

async function lookupArtist(term) {
  const startedAt = performance.now();
  const response = await fetch(`/api/v1/artist/lookup?term=${encodeURIComponent(term)}`);
  const duration = Math.round(performance.now() - startedAt);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.warning || data.error || `Request failed with status ${response.status}`);
  }

  cacheEl.textContent = response.headers.get('X-Cache') || '-';
  upstreamEl.textContent = response.headers.get('X-Upstream-Calls') || '0';
  durationEl.textContent = `${duration}ms`;
  albumCountEl.textContent = String(data.albums?.length || 0);
  artistNameEl.textContent = data.artistName || 'Unknown artist';
  artistIdEl.textContent = data.foreignArtistId || '-';
  jsonEl.textContent = JSON.stringify(data, null, 2);
  renderAlbums(data.albums || []);

  if (data.partial) {
    setStatus(data.warning || 'Partial data returned', true);
  } else {
    setStatus('Lookup complete');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const term = termInput.value.trim();
  const button = form.querySelector('button');

  if (!term) {
    return;
  }

  button.disabled = true;
  setStatus('Searching...');

  try {
    await lookupArtist(term);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

toggleJsonButton.addEventListener('click', () => {
  jsonEl.hidden = !jsonEl.hidden;
});

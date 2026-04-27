const settingsPanel = document.querySelector('#settings-panel');
const logoutButton = document.querySelector('#logout');
const settingsGrid = document.querySelector('#settings-grid');
const statusEl = document.querySelector('#status');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b42318' : '#44505c';
}

function formatValue(value) {
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }

  return String(value);
}

function renderSettings(settings) {
  settingsGrid.replaceChildren();

  Object.entries(settings).forEach(([sectionName, values]) => {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    const list = document.createElement('dl');

    heading.textContent = sectionName;

    Object.entries(values).forEach(([key, value]) => {
      const term = document.createElement('dt');
      const definition = document.createElement('dd');

      term.textContent = key;
      definition.textContent = formatValue(value);
      list.append(term, definition);
    });

    section.append(heading, list);
    settingsGrid.append(section);
  });
}

async function loadSettings() {
  const response = await fetch('/api/settings');
  const data = await response.json();

  if (response.status === 401) {
    window.location.assign('/login.html');
    return;
  }

  if (!response.ok) {
    throw new Error(data.error || 'Unable to load settings');
  }

  renderSettings(data);
  settingsPanel.hidden = false;
  setStatus('Settings loaded');
}

logoutButton.addEventListener('click', async () => {
  await fetch('/api/settings/logout', {
    method: 'POST'
  });

  window.location.assign('/login.html');
});

loadSettings().catch((error) => {
  setStatus(error.message, true);
});

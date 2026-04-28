const settingsPanel = document.querySelector('#settings-panel');
const logoutButton = document.querySelector('#logout');
const settingsGrid = document.querySelector('#settings-grid');
const statusEl = document.querySelector('#status');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b42318' : 'var(--c-muted)';
}

// Human-readable labels for each config key
const LABELS = {
  userAgent:            'User-Agent',
  cacheTtlSeconds:      'Cache TTL (seconds)',
  musicbrainzBaseUrl:   'MusicBrainz Base URL',
  minRequestIntervalMs: 'Min Request Interval (ms)',
  upstreamTimeoutMs:    'Upstream Timeout (ms)',
  slowRequestMs:        'Slow Request Threshold (ms)'
};

function renderSettings(data) {
  settingsGrid.replaceChildren();

  // ── Editable config section ──
  const configSection = document.createElement('section');
  configSection.innerHTML = '<h3>Configuration</h3>';

  const form = document.createElement('form');
  form.id = 'settings-form';
  form.className = 'settings-form';

  const entries = Object.entries(data.config || {});

  entries.forEach(([key, info]) => {
    const label = document.createElement('label');
    const labelText = LABELS[key] || key;
    const isSaved = info.source === 'saved';

    label.innerHTML = `
      ${labelText}
      ${isSaved ? '<span class="saved-badge" title="Customized — saved to settings.json">saved</span>' : ''}
    `;

    const input = document.createElement('input');
    input.name = key;
    input.value = info.value;
    input.type = typeof info.value === 'number' ? 'number' : 'text';

    if (typeof info.value === 'number') {
      input.min = '1';
    }

    label.append(input);
    form.append(label);
  });

  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.textContent = 'Save changes';
  form.append(saveButton);

  configSection.append(form);
  settingsGrid.append(configSection);

  // ── Read-only server info ──
  const serverSection = document.createElement('section');
  serverSection.innerHTML = '<h3>Server (read-only)</h3>';

  const dl = document.createElement('dl');

  if (data.server) {
    Object.entries(data.server).forEach(([key, info]) => {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = key;
      dd.textContent = info.value;
      dl.append(dt, dd);
    });
  }

  if (data.admin) {
    Object.entries(data.admin).forEach(([key, value]) => {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = key;
      dd.textContent = typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
      dl.append(dt, dd);
    });
  }

  serverSection.append(dl);
  settingsGrid.append(serverSection);

  // ── Form submit handler ──
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    setStatus('Saving...');

    const formData = new FormData(form);
    const updates = {};

    for (const [key, value] of formData.entries()) {
      const original = data.config[key];

      if (!original) {
        continue;
      }

      const coerced = typeof original.value === 'number' ? Number(value) : value;

      if (coerced !== original.value) {
        updates[key] = coerced;
      }
    }

    if (Object.keys(updates).length === 0) {
      setStatus('No changes to save');
      saveButton.disabled = false;
      return;
    }

    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Save failed');
      }

      const appliedCount = Object.keys(result.applied || {}).length;
      const skippedKeys = Object.keys(result.skipped || {});

      if (skippedKeys.length > 0) {
        const reasons = skippedKeys.map((k) => `${k}: ${result.skipped[k]}`).join(', ');
        setStatus(`Saved ${appliedCount} setting(s). Skipped: ${reasons}`, true);
      } else {
        setStatus(`Saved ${appliedCount} setting(s)`);
      }

      // Reload the settings to show updated values
      await loadSettings();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      saveButton.disabled = false;
    }
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

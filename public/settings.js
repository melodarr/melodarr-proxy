const settingsPanel = document.querySelector('#settings-panel')
const logoutButton = document.querySelector('#logout')
const settingsGrid = document.querySelector('#settings-grid')
const statusEl = document.querySelector('#status')

function setStatus (message, isError = false) {
  statusEl.textContent = message
  statusEl.style.color = isError ? '#b42318' : 'var(--c-muted)'
}

// Human-readable labels for each config key
const LABELS = {
  appName: 'Product Name',
  appVersion: 'Version',
  appContact: 'Contact',
  cacheTtlSeconds: 'Cache TTL (seconds)',
  musicbrainzBaseUrl: 'MusicBrainz Base URL',
  minRequestIntervalMs: 'Min Request Interval (ms)',
  upstreamTimeoutMs: 'Upstream Timeout (ms)',
  slowRequestMs: 'Slow Request Threshold (ms)',
  metadataProviders: 'Metadata Providers',
  lastfmApiKey: 'Last.fm API Key',
  discogsToken: 'Discogs Token',
  theAudioDbApiKey: 'TheAudioDB API Key',
  itunesCountry: 'iTunes Country',
  providerPriority: 'Provider Priority'
}

const PROVIDERS = [
  { id: 'musicbrainz', label: 'MusicBrainz', note: 'Canonical IDs and release groups' },
  { id: 'itunes', label: 'iTunes', note: 'Catalog fallback and artwork' },
  { id: 'theaudiodb', label: 'TheAudioDB', note: 'Requires API key' },
  { id: 'lastfm', label: 'Last.fm', note: 'Requires API key' },
  { id: 'discogs', label: 'Discogs', note: 'Requires token; higher call cost' }
]

function providerListFromValue (value) {
  return String(value || '')
    .split(',')
    .map(provider => provider.trim().toLowerCase())
    .filter(Boolean)
}

function renderSettings (data) {
  settingsGrid.replaceChildren()

  // ── Editable config section ──
  const configSection = document.createElement('section')
  configSection.innerHTML = '<h3>Configuration</h3>'

  const form = document.createElement('form')
  form.id = 'settings-form'
  form.className = 'settings-form'

  const entries = Object.entries(data.config || {})

  entries.forEach(([key, info]) => {
    const label = document.createElement('label')
    const labelText = LABELS[key] || key
    const isSaved = info.source === 'saved'

    label.innerHTML = `
      ${labelText}
      ${isSaved ? '<span class="saved-badge" title="Customized — saved to settings.json">saved</span>' : ''}
    `

    const input = document.createElement('input')
    input.name = key
    input.value = info.value
    input.type = typeof info.value === 'number' ? 'number' : 'text'

    if (typeof info.value === 'number') {
      input.min = '1'
    }

    if (key === 'metadataProviders') {
      const selectedProviders = new Set(providerListFromValue(info.value))
      const wrapper = document.createElement('div')
      const hiddenInput = document.createElement('input')

      wrapper.className = 'provider-options'
      hiddenInput.type = 'hidden'
      hiddenInput.name = key
      hiddenInput.value = providerListFromValue(info.value).join(',')

      const syncProviders = () => {
        const enabled = [...wrapper.querySelectorAll('input[type="checkbox"]:checked')]
          .map(checkbox => checkbox.value)
        hiddenInput.value = enabled.join(',')
      }

      PROVIDERS.forEach((provider) => {
        const option = document.createElement('label')
        const checkbox = document.createElement('input')
        const text = document.createElement('span')
        const note = document.createElement('small')

        option.className = 'provider-option'
        checkbox.type = 'checkbox'
        checkbox.value = provider.id
        checkbox.checked = selectedProviders.has(provider.id)
        checkbox.addEventListener('change', syncProviders)
        text.textContent = provider.label
        note.textContent = provider.note

        option.append(checkbox, text, note)
        wrapper.append(option)
      })

      label.append(wrapper, hiddenInput)
    } else if (key === 'appName') {
      const container = document.createElement('div')
      container.style.display = 'flex'
      container.style.flexDirection = 'column'
      container.style.gap = '8px'

      const wrapper = document.createElement('div')
      wrapper.style.display = 'flex'
      wrapper.style.gap = '8px'

      input.style.flex = '1'
      wrapper.append(input)

      const regenBtn = document.createElement('button')
      regenBtn.type = 'button'
      regenBtn.textContent = 'Generate New'
      regenBtn.style.whiteSpace = 'nowrap'
      regenBtn.style.padding = '4px 12px'
      wrapper.append(regenBtn)

      const historyContainer = document.createElement('div')
      historyContainer.className = 'name-history'
      historyContainer.style.display = 'flex'
      historyContainer.style.flexWrap = 'wrap'
      historyContainer.style.gap = '6px'

      const loadNameHistory = async () => {
        try {
          const res = await fetch('/api/settings/name-history')
          if (res.ok) {
            const data = await res.json()
            historyContainer.replaceChildren()
            data.history.forEach(name => {
              const pill = document.createElement('span')
              pill.textContent = name
              pill.className = 'history-pill'
              pill.title = 'Click to use this name'
              pill.style.cursor = 'pointer'
              pill.style.fontSize = '0.75rem'
              pill.style.padding = '2px 8px'
              pill.style.background = 'var(--bg-surface-alt)'
              pill.style.borderRadius = 'var(--radius-sm)'
              pill.style.border = '1px solid var(--border-subtle)'
              pill.style.color = 'var(--text-secondary)'
              pill.style.transition = 'all 0.15s ease'

              pill.addEventListener('click', () => {
                input.value = name
              })

              pill.addEventListener('mouseenter', () => {
                pill.style.background = 'var(--accent-dim)'
                pill.style.color = 'var(--accent)'
                pill.style.borderColor = 'var(--accent-ring)'
              })

              pill.addEventListener('mouseleave', () => {
                pill.style.background = 'var(--bg-surface-alt)'
                pill.style.color = 'var(--text-secondary)'
                pill.style.borderColor = 'var(--border-subtle)'
              })

              historyContainer.append(pill)
            })
          }
        } catch (e) {
          console.error('Failed to load name history', e)
        }
      }

      regenBtn.addEventListener('click', async () => {
        try {
          regenBtn.disabled = true
          const res = await fetch('/api/settings/generate-name', { method: 'POST' })
          if (!res.ok) throw new Error('Failed to generate name')
          const data = await res.json()
          input.value = data.name
          await loadNameHistory()
        } catch (e) {
          setStatus(e.message, true)
        } finally {
          regenBtn.disabled = false
        }
      })

      loadNameHistory()

      container.append(wrapper, historyContainer)
      label.append(container)
    } else {
      label.append(input)
    }

    form.append(label)
  })

  const saveButton = document.createElement('button')
  saveButton.type = 'submit'
  saveButton.textContent = 'Save changes'
  form.append(saveButton)

  configSection.append(form)
  settingsGrid.append(configSection)

  // ── Read-only server info ──
  const serverSection = document.createElement('section')
  serverSection.innerHTML = '<h3>Server (read-only)</h3>'

  const dl = document.createElement('dl')

  if (data.server) {
    Object.entries(data.server).forEach(([key, info]) => {
      const dt = document.createElement('dt')
      const dd = document.createElement('dd')
      dt.textContent = key
      dd.textContent = info.value
      dl.append(dt, dd)
    })
  }

  if (data.admin) {
    Object.entries(data.admin).forEach(([key, value]) => {
      const dt = document.createElement('dt')
      const dd = document.createElement('dd')
      dt.textContent = key
      dd.textContent = typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value)
      dl.append(dt, dd)
    })
  }

  serverSection.append(dl)
  settingsGrid.append(serverSection)

  const apiKeySection = document.createElement('section')
  apiKeySection.innerHTML = '<h3>API keys</h3>'

  const apiKeyForm = document.createElement('form')
  apiKeyForm.className = 'settings-form'

  const keyNameLabel = document.createElement('label')
  keyNameLabel.textContent = 'Name'
  const keyNameInput = document.createElement('input')
  keyNameInput.name = 'name'
  keyNameInput.placeholder = 'Lidarr'
  keyNameInput.required = true
  keyNameLabel.append(keyNameInput)

  const quotaLabel = document.createElement('label')
  quotaLabel.textContent = 'Quota per minute'
  const quotaInput = document.createElement('input')
  quotaInput.name = 'quota'
  quotaInput.type = 'number'
  quotaInput.min = '1'
  quotaInput.value = '60'
  quotaLabel.append(quotaInput)

  const createKeyButton = document.createElement('button')
  createKeyButton.type = 'submit'
  createKeyButton.textContent = 'Create API key'

  const createdKey = document.createElement('pre')
  createdKey.hidden = true

  const apiKeyList = document.createElement('dl')

  apiKeyForm.append(keyNameLabel, quotaLabel, createKeyButton)
  apiKeySection.append(apiKeyForm, createdKey, apiKeyList)
  settingsGrid.append(apiKeySection)

  async function loadApiKeys () {
    const response = await fetch('/api/admin/keys')
    const result = await response.json()

    if (!response.ok) {
      throw new Error(result.error || 'Unable to load API keys')
    }

    apiKeyList.replaceChildren()

    if (!result.keys?.length) {
      const dt = document.createElement('dt')
      const dd = document.createElement('dd')
      dt.textContent = 'Status'
      dd.textContent = 'No API keys created'
      apiKeyList.append(dt, dd)
      return
    }

    result.keys.forEach((key) => {
      const dt = document.createElement('dt')
      const dd = document.createElement('dd')
      const revoke = document.createElement('button')

      dt.textContent = key.name
      revoke.type = 'button'
      revoke.textContent = 'Revoke'
      revoke.className = 'inline-danger'
      revoke.addEventListener('click', async () => {
        const response = await fetch(`/api/admin/keys/${encodeURIComponent(key.id)}`, {
          method: 'DELETE'
        })
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || 'Unable to revoke API key')
        }
        setStatus('API key revoked')
        await loadApiKeys()
      })

      dd.append(
        document.createTextNode(`ID ${key.id}; quota ${key.quotaPerMinute}/min; used ${key.usage || 0}`),
        document.createElement('br'),
        revoke
      )
      apiKeyList.append(dt, dd)
    })
  }

  apiKeyForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    createKeyButton.disabled = true
    setStatus('Creating API key...')

    try {
      const formData = new FormData(apiKeyForm)
      const response = await fetch('/api/admin/keys/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.get('name'),
          quota: Number(formData.get('quota') || 60)
        })
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Unable to create API key')
      }

      createdKey.hidden = false
      createdKey.textContent = `Copy this key now. It will not be shown again.\n\n${result.key}`
      apiKeyForm.reset()
      quotaInput.value = '60'
      setStatus('API key created')
      await loadApiKeys()
    } catch (error) {
      setStatus(error.message, true)
    } finally {
      createKeyButton.disabled = false
    }
  })

  loadApiKeys().catch((error) => {
    setStatus(error.message, true)
  })

  // ── Form submit handler ──
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    saveButton.disabled = true
    setStatus('Saving...')

    const formData = new FormData(form)
    const updates = {}

    for (const [key, value] of formData.entries()) {
      const original = data.config[key]

      if (!original) {
        continue
      }

      const coerced = typeof original.value === 'number' ? Number(value) : value

      if (coerced !== original.value) {
        updates[key] = coerced
      }
    }

    if (Object.keys(updates).length === 0) {
      setStatus('No changes to save')
      saveButton.disabled = false
      return
    }

    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Save failed')
      }

      const appliedCount = Object.keys(result.applied || {}).length
      const skippedKeys = Object.keys(result.skipped || {})

      if (skippedKeys.length > 0) {
        const reasons = skippedKeys.map((k) => `${k}: ${result.skipped[k]}`).join(', ')
        setStatus(`Saved ${appliedCount} setting(s). Skipped: ${reasons}`, true)
      } else {
        setStatus(`Saved ${appliedCount} setting(s)`)
      }

      // Reload the settings to show updated values
      await loadSettings()
    } catch (error) {
      setStatus(error.message, true)
    } finally {
      saveButton.disabled = false
    }
  })
}

async function loadSettings () {
  const response = await fetch('/api/settings')
  const data = await response.json()

  if (response.status === 401) {
    window.location.assign('/login.html')
    return
  }

  if (!response.ok) {
    throw new Error(data.error || 'Unable to load settings')
  }

  renderSettings(data)
  settingsPanel.hidden = false
  setStatus('Settings loaded')
}

logoutButton.addEventListener('click', async () => {
  await fetch('/api/settings/logout', {
    method: 'POST'
  })

  window.location.assign('/login.html')
})

loadSettings().catch((error) => {
  setStatus(error.message, true)
})

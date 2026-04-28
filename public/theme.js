/* global localStorage */

(function () {
  const STORAGE_KEY = 'melodarr-theme'

  // Restore saved preference immediately to prevent flash
  const saved = localStorage.getItem(STORAGE_KEY)

  if (saved === 'light' || saved === 'dark') {
    document.documentElement.dataset.theme = saved
  }
  // else: default is dark via CSS :root (no data-theme attribute needed)

  function getTheme () {
    return document.documentElement.dataset.theme || 'dark'
  }

  function setTheme (theme) {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(STORAGE_KEY, theme)
    updateToggle(theme)
  }

  function updateToggle (theme) {
    const toggle = document.querySelector('[data-theme-toggle]')

    if (!toggle) {
      return
    }

    const isDark = theme === 'dark'
    toggle.innerHTML = isDark ? '☀ Light' : '● Dark'
    toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode')
    toggle.title = isDark ? 'Switch to light mode' : 'Switch to dark mode'
  }

  function installToggle () {
    const header = document.querySelector('.lookup-panel')

    if (!header || document.querySelector('[data-theme-toggle]')) {
      return
    }

    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'theme-toggle'
    toggle.dataset.themeToggle = 'true'
    toggle.addEventListener('click', () => {
      setTheme(getTheme() === 'dark' ? 'light' : 'dark')
    })

    header.append(toggle)
    updateToggle(getTheme())
  }

  installToggle()
})()

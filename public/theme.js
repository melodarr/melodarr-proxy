/* global localStorage */

(function () {
  const STORAGE_KEY = 'melodarr-theme'

  // Restore saved preference immediately to prevent flash
  const saved = localStorage.getItem(STORAGE_KEY)

  if (saved === 'light' || saved === 'dark') {
    document.documentElement.dataset.theme = saved
  } else {
    // Check system preference
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    document.documentElement.dataset.theme = prefersLight ? 'light' : 'dark'
  }

  function getTheme () {
    return document.documentElement.dataset.theme || 'dark'
  }

  function setTheme (theme) {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(STORAGE_KEY, theme)
    updateToggle(theme)
  }

  function updateToggle (theme) {
    const toggles = document.querySelectorAll('[data-theme-toggle]')

    if (!toggles.length) {
      return
    }

    const isDark = theme === 'dark'
    toggles.forEach(toggle => {
      toggle.innerHTML = isDark ? '☀ Light' : '● Dark'
      toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode')
      toggle.title = isDark ? 'Switch to light mode' : 'Switch to dark mode'
    })
  }

  function initToggles () {
    const existingToggles = document.querySelectorAll('[data-theme-toggle]')

    if (existingToggles.length > 0) {
      existingToggles.forEach(toggle => {
        toggle.addEventListener('click', () => {
          setTheme(getTheme() === 'dark' ? 'light' : 'dark')
        })
      })
      updateToggle(getTheme())
      return
    }

    const nav = document.querySelector('.top-nav')
    if (!nav) return

    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'theme-toggle-header theme-toggle'
    toggle.dataset.themeToggle = 'true'
    toggle.style.marginLeft = 'auto'
    toggle.addEventListener('click', () => {
      setTheme(getTheme() === 'dark' ? 'light' : 'dark')
    })

    nav.append(toggle)
    updateToggle(getTheme())
  }

  initToggles()
})()

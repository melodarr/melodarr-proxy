(function () {
  const STORAGE_KEY = 'melodarr-theme';

  function getTheme() {
    return document.documentElement.dataset.theme || 'dark';
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
    updateToggle(theme);
  }

  function updateToggle(theme) {
    const toggle = document.querySelector('[data-theme-toggle]');
    if (!toggle) {
      return;
    }

    const isDark = theme === 'dark';
    toggle.textContent = isDark ? 'Light mode' : 'Dark mode';
    toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    toggle.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  }

  function installToggle() {
    const header = document.querySelector('.lookup-panel');
    if (!header || document.querySelector('[data-theme-toggle]')) {
      return;
    }

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'theme-toggle';
    toggle.dataset.themeToggle = 'true';
    toggle.addEventListener('click', () => {
      setTheme(getTheme() === 'dark' ? 'light' : 'dark');
    });

    header.append(toggle);
    updateToggle(getTheme());
  }

  installToggle();
})();

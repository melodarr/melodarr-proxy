const authPanel = document.querySelector('#auth-panel');
const statusEl = document.querySelector('#status');
const introEl = document.querySelector('#auth-intro');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b42318' : '#44505c';
}

function goHome() {
  window.location.assign('/');
}

function renderLogin() {
  introEl.textContent = 'Sign in to access the proxy pages.';
  authPanel.innerHTML = `
    <section class="result settings-panel">
      <div class="artist-header">
        <div>
          <h2>Sign in</h2>
          <code>Local admin password</code>
        </div>
      </div>
      <form id="login-form" class="settings-form">
        <label>
          Password
          <input id="password" name="password" type="password" autocomplete="current-password" required placeholder="Enter your password">
        </label>
        <button type="submit">Unlock</button>
      </form>
      <details class="reset-help">
        <summary>Forgot password?</summary>
        <div class="reset-help-body">
          <p>Reset via the CLI, then reload this page:</p>
          <pre><code># Local
npm run reset-password

# Docker
docker compose exec proxy \
  node src/server.js --reset-password</code></pre>
        </div>
      </details>
    </section>
  `;

  document.querySelector('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    const password = document.querySelector('#password').value;

    button.disabled = true;
    setStatus('Signing in...');

    try {
      const response = await fetch('/api/settings/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Sign in failed');
      }

      goHome();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  setStatus('Enter the local admin password');
}

function renderSetup() {
  introEl.textContent = 'Create the local admin password to finish first-run setup.';
  authPanel.innerHTML = `
    <section class="result settings-panel">
      <div class="artist-header">
        <div>
          <h2>Create admin password</h2>
          <code>Stored as a hash in the local data volume.</code>
        </div>
      </div>
      <form id="setup-form" class="settings-form">
        <label>
          Password
          <input id="setup-password" name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="Minimum 8 characters">
        </label>
        <label>
          Confirm password
          <input id="setup-confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" required placeholder="Confirm your password">
        </label>
        <button type="submit">Create password</button>
      </form>
    </section>
  `;

  document.querySelector('#setup-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    const password = document.querySelector('#setup-password').value;
    const confirm = document.querySelector('#setup-confirm').value;

    if (password !== confirm) {
      setStatus('Passwords do not match', true);
      return;
    }

    button.disabled = true;
    setStatus('Creating password...');

    try {
      const response = await fetch('/api/settings/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Password setup failed');
      }

      goHome();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  setStatus('Create the local admin password');
}

async function checkStatus() {
  const response = await fetch('/api/settings/status');
  const status = await response.json();

  if (status.authenticated) {
    goHome();
    return;
  }

  if (status.setupRequired) {
    renderSetup();
    return;
  }

  renderLogin();
}

checkStatus().catch((error) => {
  setStatus(error.message, true);
});

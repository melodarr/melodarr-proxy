const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const settingsPath = path.join(dataDir, 'settings.json');
let settings = loadSettings();

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (_error) {
    return {};
  }
}

function saveSettings(nextSettings) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, { mode: 0o600 });
  settings = nextSettings;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  return {
    algorithm: 'scrypt',
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString('base64url')
  };
}

function hasAdminPassword() {
  return Boolean(process.env.ADMIN_PASSWORD || settings.adminPasswordHash);
}

function canBootstrapAdmin() {
  return !hasAdminPassword();
}

function getSessionSecret() {
  if (process.env.SETTINGS_SESSION_SECRET) {
    return process.env.SETTINGS_SESSION_SECRET;
  }

  if (process.env.ADMIN_PASSWORD) {
    return process.env.ADMIN_PASSWORD;
  }

  return settings.sessionSecret || '';
}

function bootstrapAdminPassword(password) {
  if (!canBootstrapAdmin()) {
    const error = new Error('Admin password is already configured');
    error.status = 409;
    throw error;
  }

  saveSettings({
    ...settings,
    adminPasswordHash: hashPassword(password),
    sessionSecret: crypto.randomBytes(32).toString('base64url')
  });
}

function verifyPassword(password) {
  if (process.env.ADMIN_PASSWORD) {
    const passwordBuffer = Buffer.from(password);
    const expectedBuffer = Buffer.from(process.env.ADMIN_PASSWORD);
    return passwordBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(passwordBuffer, expectedBuffer);
  }

  if (!settings.adminPasswordHash) {
    return false;
  }

  const stored = settings.adminPasswordHash;
  const nextHash = hashPassword(password, stored.salt).hash;
  const passwordBuffer = Buffer.from(nextHash);
  const expectedBuffer = Buffer.from(stored.hash);

  return passwordBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(passwordBuffer, expectedBuffer);
}

function resetPassword() {
  if (process.env.ADMIN_PASSWORD) {
    return { cleared: false, reason: 'Password is set via ADMIN_PASSWORD env var — remove it from your environment to reset.' };
  }

  if (!settings.adminPasswordHash) {
    return { cleared: false, reason: 'No stored password found. Setup flow will appear on next login.' };
  }

  const next = { ...settings };
  delete next.adminPasswordHash;
  delete next.sessionSecret;
  saveSettings(next);

  return { cleared: true };
}

// ── Runtime config (editable from UI) ────────────────────────────
// Keys that can be changed at runtime via the settings page.
// Precedence: saved (settings.json) > env var > built-in fallback.
// The env var values serve as *defaults*, not locks.
const EDITABLE_KEYS = {
  userAgent:               { env: 'APP_USER_AGENT',                      fallback: `proxy-${crypto.randomBytes(4).toString('hex')}/1.0 (contact-${crypto.randomBytes(4).toString('hex')}@example.com)`, type: 'string' },
  cacheTtlSeconds:         { env: 'CACHE_TTL_SECONDS',                   fallback: 86400,  type: 'number' },
  musicbrainzBaseUrl:      { env: 'MUSICBRAINZ_BASE_URL',                fallback: 'https://musicbrainz.org/ws/2', type: 'string' },
  minRequestIntervalMs:    { env: 'MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS', fallback: 1100,   type: 'number' },
  upstreamTimeoutMs:       { env: 'UPSTREAM_TIMEOUT_MS',                 fallback: 8000,   type: 'number' },
  slowRequestMs:           { env: 'SLOW_REQUEST_MS',                     fallback: 2000,   type: 'number' }
};

function getRuntimeConfig() {
  const config = {};

  for (const [key, spec] of Object.entries(EDITABLE_KEYS)) {
    const storedValue = settings.runtime?.[key];
    const envValue = process.env[spec.env];

    if (storedValue !== undefined) {
      // Saved value always wins — user explicitly set it
      config[key] = { value: storedValue, source: 'saved' };
    } else if (envValue !== undefined && envValue !== '') {
      // Env var as the default (editable)
      config[key] = { value: spec.type === 'number' ? Number(envValue) : envValue, source: 'default' };
    } else {
      config[key] = { value: spec.fallback, source: 'default' };
    }
  }

  return config;
}

function getConfigValue(key) {
  const spec = EDITABLE_KEYS[key];

  if (!spec) {
    return undefined;
  }

  // Saved values always win
  if (settings.runtime?.[key] !== undefined) {
    return settings.runtime[key];
  }

  const envValue = process.env[spec.env];

  if (envValue !== undefined && envValue !== '') {
    return spec.type === 'number' ? Number(envValue) : envValue;
  }

  return spec.fallback;
}

function updateRuntimeConfig(updates) {
  const applied = {};
  const skipped = {};

  for (const [key, value] of Object.entries(updates)) {
    const spec = EDITABLE_KEYS[key];

    if (!spec) {
      skipped[key] = 'Unknown setting';
      continue;
    }

    const coerced = spec.type === 'number' ? Number(value) : String(value);

    if (spec.type === 'number' && (Number.isNaN(coerced) || coerced <= 0)) {
      skipped[key] = 'Must be a positive number';
      continue;
    }

    applied[key] = coerced;
  }

  if (Object.keys(applied).length > 0) {
    saveSettings({
      ...settings,
      runtime: { ...settings.runtime, ...applied }
    });
  }

  return { applied, skipped };
}

module.exports = {
  bootstrapAdminPassword,
  canBootstrapAdmin,
  getConfigValue,
  getRuntimeConfig,
  getSessionSecret,
  hasAdminPassword,
  resetPassword,
  updateRuntimeConfig,
  verifyPassword
};

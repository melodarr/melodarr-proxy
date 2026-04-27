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

module.exports = {
  bootstrapAdminPassword,
  canBootstrapAdmin,
  getSessionSecret,
  hasAdminPassword,
  resetPassword,
  verifyPassword
};

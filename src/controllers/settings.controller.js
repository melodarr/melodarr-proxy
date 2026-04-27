const crypto = require('crypto');
const {
  bootstrapAdminPassword,
  canBootstrapAdmin,
  getSessionSecret,
  hasAdminPassword,
  verifyPassword
} = require('../settings/store');

const SETTINGS_COOKIE = 'melodarr_proxy_settings';
const SETTINGS_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function getCookie(req, name) {
  const cookies = req.headers.cookie || '';
  const match = cookies
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

function signPayload(payload) {
  return crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

function createToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SETTINGS_SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${signPayload(payload)}`;
}

function isTokenValid(token) {
  if (!hasAdminPassword() || !getSessionSecret() || !token) {
    return false;
  }

  const [payload, signature] = token.split('.');

  if (!payload || !signature) {
    return false;
  }

  const expected = signPayload(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return false;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(parsed.exp) > Date.now();
  } catch (_error) {
    return false;
  }
}

function isAuthenticated(req) {
  return isTokenValid(getCookie(req, SETTINGS_COOKIE));
}

function setAuthCookie(res) {
  res.cookie(SETTINGS_COOKIE, createToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: SETTINGS_SESSION_TTL_MS
  });
}

function requireSettingsAuth(req, res, next) {
  if (isAuthenticated(req)) {
    return next();
  }

  return res.status(401).json({
    error: hasAdminPassword() ? 'Authentication required' : 'Settings password is not configured'
  });
}

function getSettingsPayload() {
  const userAgent =
    process.env.APP_USER_AGENT ||
    process.env.MUSICBRAINZ_USER_AGENT ||
    'melodarr-proxy/0.1.0 (replace-with-contact@example.com)';

  return {
    app: {
      userAgent,
      userAgentConfigured: !userAgent.includes('replace-with-contact') && !userAgent.includes('your-contact')
    },
    server: {
      port: Number(process.env.PORT || 3000),
      slowRequestMs: Number(process.env.SLOW_REQUEST_MS || 2000)
    },
    cache: {
      redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
      ttlSeconds: Number(process.env.CACHE_TTL_SECONDS || 24 * 60 * 60)
    },
    musicbrainz: {
      baseUrl: process.env.MUSICBRAINZ_BASE_URL || 'https://musicbrainz.org/ws/2',
      minRequestIntervalMs: Number(process.env.MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS || 1100),
      timeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS || 8000)
    },
    admin: {
      passwordConfigured: hasAdminPassword(),
      envPasswordConfigured: Boolean(process.env.ADMIN_PASSWORD),
      bootstrapAvailable: canBootstrapAdmin()
    }
  };
}

function getSettingsStatus(req, res) {
  res.json({
    enabled: hasAdminPassword(),
    setupRequired: canBootstrapAdmin(),
    authenticated: isAuthenticated(req)
  });
}

function setupSettings(req, res) {
  if (!canBootstrapAdmin()) {
    return res.status(409).json({
      error: 'Admin password is already configured'
    });
  }

  const password = String(req.body?.password || '');

  if (password.length < 8) {
    return res.status(400).json({
      error: 'Password must be at least 8 characters'
    });
  }

  bootstrapAdminPassword(password);
  setAuthCookie(res);

  return res.json({
    ok: true
  });
}

function loginSettings(req, res) {
  if (!hasAdminPassword()) {
    return res.status(503).json({
      error: 'Create the admin password before signing in'
    });
  }

  if (!verifyPassword(String(req.body?.password || ''))) {
    return res.status(401).json({
      error: 'Invalid password'
    });
  }

  setAuthCookie(res);

  return res.json({
    ok: true
  });
}

function logoutSettings(_req, res) {
  res.clearCookie(SETTINGS_COOKIE);
  res.json({
    ok: true
  });
}

function getSettings(_req, res) {
  res.json(getSettingsPayload());
}

module.exports = {
  getSettings,
  getSettingsStatus,
  isAuthenticated,
  loginSettings,
  logoutSettings,
  requireSettingsAuth,
  setupSettings
};

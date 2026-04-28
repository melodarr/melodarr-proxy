const axios = require('axios');
const dns = require('dns');
const https = require('https');
const { getConfigValue } = require('../settings/store');

const httpsAgent = new https.Agent({
  keepAlive: true,
  lookup(hostname, options, callback) {
    return dns.lookup(hostname, { ...options, family: 4 }, callback);
  }
});

let lastRequestTime = 0;
let requestQueue = Promise.resolve();

async function enqueueRequest(fn) {
  const minInterval = getConfigValue('minRequestIntervalMs') || 1100;
  
  const waitPromise = requestQueue.then(async () => {
    const now = Date.now();
    const timeSinceLast = now - lastRequestTime;
    if (timeSinceLast < minInterval) {
      await new Promise(resolve => setTimeout(resolve, minInterval - timeSinceLast));
    }
    lastRequestTime = Date.now();
  }).catch(() => {
    lastRequestTime = Date.now();
  });
  
  requestQueue = waitPromise;
  await waitPromise;
  
  return fn();
}

class UpstreamService {
  getUserAgent() {
    const appName = getConfigValue('appName');
    const appVersion = getConfigValue('appVersion');
    const appContact = getConfigValue('appContact');
    return `${appName}/${appVersion} (${appContact})`;
  }

  async checkHealth() {
    const baseUrl = getConfigValue('musicbrainzBaseUrl');
    const userAgent = this.getUserAgent();
    const timeout = getConfigValue('upstreamTimeoutMs');

    try {
      return await enqueueRequest(async () => {
        const res = await axios.get(`${baseUrl}/artist/?query=test&fmt=json&limit=1`, {
          headers: { 'User-Agent': userAgent },
          httpsAgent,
          timeout
        });
        return res.status === 200 ? 'reachable' : 'unreachable';
      });
    } catch (err) {
      return 'unreachable';
    }
  }

  async search(query) {
    const baseUrl = getConfigValue('musicbrainzBaseUrl');
    const userAgent = this.getUserAgent();
    const timeout = getConfigValue('upstreamTimeoutMs');

    return enqueueRequest(async () => {
      const url = `${baseUrl}/artist/?query=${encodeURIComponent(query)}&fmt=json`;
      const res = await axios.get(url, {
        headers: { 'User-Agent': userAgent },
        httpsAgent,
        timeout
      });
      return res.data;
    });
  }

  async musicBrainzGet(path, params) {
    const baseUrl = getConfigValue('musicbrainzBaseUrl');
    const userAgent = this.getUserAgent();
    const timeout = getConfigValue('upstreamTimeoutMs');

    let lastError;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await enqueueRequest(async () => {
          const response = await axios.get(`${baseUrl}${path}`, {
            headers: { 'User-Agent': userAgent },
            httpsAgent,
            params: { fmt: 'json', ...params },
            timeout
          });
          return response.data;
        });
      } catch (error) {
        lastError = error;

        if (error.response?.status && error.response.status < 500 && error.response.status !== 429) {
          throw error;
        }

        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        }
      }
    }

    throw lastError;
  }
}

module.exports = new UpstreamService();

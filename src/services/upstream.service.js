const axios = require('axios');
const { getConfigValue } = require('../settings/store');

class UpstreamService {
  async checkHealth() {
    const baseUrl = getConfigValue('musicbrainzBaseUrl');
    const timeout = getConfigValue('upstreamTimeoutMs');

    try {
      // Just a lightweight request to see if it's reachable
      const res = await axios.get(`${baseUrl}/artist/?query=test&fmt=json&limit=1`, { timeout });
      return res.status === 200 ? 'reachable' : 'unreachable';
    } catch (err) {
      return 'unreachable';
    }
  }

  async search(query) {
    const baseUrl = getConfigValue('musicbrainzBaseUrl');
    const userAgent = getConfigValue('userAgent');
    const timeout = getConfigValue('upstreamTimeoutMs');

    const url = `${baseUrl}/artist/?query=${encodeURIComponent(query)}&fmt=json`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent': userAgent
      },
      timeout
    });
    return res.data;
  }
}

module.exports = new UpstreamService();

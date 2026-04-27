const axios = require('axios');

class UpstreamService {
  constructor() {
    this.baseUrl = process.env.UPSTREAM_URL || 'https://musicbrainz.org/ws/2';
  }

  async checkHealth() {
    try {
      // Just a lightweight request to see if it's reachable
      const res = await axios.get(`${this.baseUrl}/artist/?query=test&fmt=json&limit=1`, { timeout: 5000 });
      return res.status === 200 ? 'reachable' : 'unreachable';
    } catch (err) {
      return 'unreachable';
    }
  }

  async search(query) {
    const url = `${this.baseUrl}/artist/?query=${encodeURIComponent(query)}&fmt=json`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'MelodarrProxy/1.0.0 ( jasonwalker )'
      },
      timeout: 10000
    });
    return res.data;
  }
}

module.exports = new UpstreamService();

const metrics = require('../metrics');
const cache = require('../cache');
const upstreamService = require('../services/upstream.service');
const axios = require('axios');
const { getConfigValue } = require('../settings/store');

// Bonus: Track top queries and repeated queries
const queryCounts = new Map();

async function handleSearch(req, res) {
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter "q"' });
  }

  const cacheKey = `search:${q}`;

  // Check cache
  const cachedData = await cache.get(cacheKey);
  if (cachedData) {
    metrics.recordCache(true);
    return res.json(cachedData);
  }

  metrics.recordCache(false);

  try {
    const data = await upstreamService.search(q);
    
    // Bonus logic: Repeated queries get longer TTL
    let count = queryCounts.get(q) || 0;
    count++;
    queryCounts.set(q, count);
    
    let ttl = 86400; // 24h default
    if (count > 5) {
      ttl = 86400 * 3; // 3 days if queried many times
    }

    await cache.set(cacheKey, data, ttl);

    res.json(data);
  } catch (err) {
    console.error('[Proxy] Upstream error:', err.message);
    res.status(502).json({ error: 'Failed to fetch from upstream API' });
  }
}

function mbQueryValue(value) {
  return String(value || '').replace(/"/g, '\\"');
}

function selectBestArtist(searchResult, term) {
  const artists = searchResult?.artists || [];

  if (artists.length === 0) {
    return null;
  }

  const normalizedTerm = String(term).trim().toLowerCase();
  const exactMatch = artists.find((artist) => {
    const name = String(artist.name || '').toLowerCase();
    const sortName = String(artist['sort-name'] || '').toLowerCase();
    return name === normalizedTerm || sortName === normalizedTerm;
  });

  return exactMatch || artists[0];
}

function toArtistResponse(artist, releaseGroups, partial = false, warning = null) {
  if (!artist) {
    return null;
  }

  const response = {
    artistName: artist.name || artist['sort-name'] || '',
    foreignArtistId: artist.id,
    albums: [...releaseGroups]
      .sort((a, b) => {
        const dateA = a['first-release-date'] || '9999';
        const dateB = b['first-release-date'] || '9999';
        return dateA.localeCompare(dateB) || String(a.title || '').localeCompare(String(b.title || ''));
      })
      .map((group) => ({
        title: group.title || '',
        id: group.id,
        firstReleaseDate: group['first-release-date'] || ''
      }))
  };

  if (partial) {
    response.partial = true;
    response.warning = warning || 'Partial MusicBrainz data returned';
  }

  return response;
}

async function musicBrainzGet(path, params) {
  const baseUrl = getConfigValue('musicbrainzBaseUrl');
  const userAgent = getConfigValue('userAgent');
  const timeout = getConfigValue('upstreamTimeoutMs');

  const response = await axios.get(`${baseUrl}${path}`, {
    headers: {
      'User-Agent': userAgent
    },
    params: {
      fmt: 'json',
      ...params
    },
    timeout
  });

  return response.data;
}

async function handleArtistLookup(req, res) {
  const term = String(req.query.term || '').trim();

  if (!term) {
    return res.status(400).json({
      error: 'Missing required query parameter: term'
    });
  }

  const cacheKey = `artist:${term.toLowerCase().replace(/\s+/g, ' ')}`;
  const cachedData = await cache.get(cacheKey);

  if (cachedData) {
    metrics.recordCache(true);
    metrics.recordArtistLookup({ term, upstreamCalls: 0, partial: Boolean(cachedData.partial), statusCode: 200 });
    res.set('X-Cache', 'HIT');
    return res.json(cachedData);
  }

  metrics.recordCache(false);

  try {
    const artistSearch = await musicBrainzGet('/artist', {
      query: `artist:"${mbQueryValue(term)}"`,
      limit: 5
    });
    const artist = selectBestArtist(artistSearch, term);

    if (!artist) {
      const emptyResponse = {
        artistName: term,
        foreignArtistId: '',
        albums: []
      };
      await cache.set(cacheKey, emptyResponse, getConfigValue('cacheTtlSeconds'));
      metrics.recordArtistLookup({ term, upstreamCalls: 1, partial: false, statusCode: 200 });
      res.set('X-Cache', 'MISS');
      res.set('X-Upstream-Calls', '1');
      return res.json(emptyResponse);
    }

    let releaseGroups = [];
    let partial = false;
    let warning = null;

    try {
      const releaseGroupResult = await musicBrainzGet('/release-group', {
        artist: artist.id,
        type: 'album|ep',
        limit: 100,
        offset: 0
      });
      releaseGroups = releaseGroupResult?.['release-groups'] || [];
    } catch (error) {
      partial = true;
      warning = error.response?.data?.error || error.message || 'Release-group lookup failed';
    }

    const response = toArtistResponse(artist, releaseGroups, partial, warning);
    await cache.set(cacheKey, response, getConfigValue('cacheTtlSeconds'));
    metrics.recordArtistLookup({ term, upstreamCalls: 2, partial, statusCode: 200, error: warning });

    res.set('X-Cache', 'MISS');
    res.set('X-Upstream-Calls', '2');
    return res.json(response);
  } catch (error) {
    console.error('[Proxy] Artist lookup failed:', error.message);
    const status = [403, 429, 503, 504].includes(error.response?.status) ? 503 : 502;
    metrics.recordArtistLookup({
      term,
      upstreamCalls: 0,
      partial: true,
      statusCode: status,
      error: error.response?.data?.error || error.message || 'Artist lookup failed'
    });
    return res.status(status).json({
      artistName: term,
      foreignArtistId: '',
      albums: [],
      partial: true,
      warning: error.response?.data?.error || error.message || 'Artist lookup failed'
    });
  }
}

module.exports = { handleArtistLookup, handleSearch };

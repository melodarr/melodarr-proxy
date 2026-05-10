const PROVIDER_TRANSPORTS = Object.freeze({
  musicbrainz: {
    provider: 'musicbrainz',
    label: 'MusicBrainz',
    url: 'https://musicbrainz.org/ws/2/artist/?query=test&fmt=json&limit=1',
    requiredFamily: 6,
    policy: 'ipv6_only',
    fallbackAllowed: false
  },
  itunes: {
    provider: 'itunes',
    label: 'Apple Music',
    url: 'https://itunes.apple.com/search?term=radiohead&entity=album&limit=1',
    requiredFamily: 'auto',
    policy: 'auto',
    fallbackAllowed: true
  },
  theaudiodb: {
    provider: 'theaudiodb',
    label: 'TheAudioDB',
    url: 'https://www.theaudiodb.com/api/v1/json/2/search.php?s=radiohead',
    requiredFamily: 'auto',
    policy: 'auto',
    fallbackAllowed: true
  },
  discogs: {
    provider: 'discogs',
    label: 'Discogs',
    url: 'https://api.discogs.com/database/search?q=radiohead&type=artist&per_page=1',
    buildUrl: (cfg) => {
      const token = String(cfg('discogsToken') || '').trim()
      const u = new URL('https://api.discogs.com/database/search?q=radiohead&type=artist&per_page=1')
      if (token) u.searchParams.set('token', token)
      return u
    },
    requiresAuth: false,
    authConfigKey: 'discogsToken',
    requiredFamily: 'auto',
    policy: 'auto',
    fallbackAllowed: true
  },
  lastfm: {
    provider: 'lastfm',
    label: 'Last.fm',
    url: 'https://ws.audioscrobbler.com/2.0/?method=artist.search&artist=radiohead&format=json&limit=1',
    buildUrl: (cfg) => {
      const key = String(cfg('lastfmApiKey') || '').trim()
      const u = new URL('https://ws.audioscrobbler.com/2.0/?method=artist.search&artist=radiohead&format=json&limit=1')
      if (key) u.searchParams.set('api_key', key)
      return u
    },
    requiresAuth: true,
    authConfigKey: 'lastfmApiKey',
    requiredFamily: 'auto',
    policy: 'auto',
    fallbackAllowed: true
  }
})

const GENERIC_PROVIDER_NAMES = Object.freeze(
  Object.keys(PROVIDER_TRANSPORTS).filter((name) => name !== 'musicbrainz')
)

function getProviderTransport (name) {
  return PROVIDER_TRANSPORTS[String(name || '').trim().toLowerCase()] || null
}

module.exports = {
  PROVIDER_TRANSPORTS,
  GENERIC_PROVIDER_NAMES,
  getProviderTransport
}

const LIDARR_LOOKUP_ARTIST_DEFAULTS = Object.freeze({
  status: 'continuing',
  aliases: Object.freeze([]),
  links: Object.freeze([])
})

const LIDARR_SKYHOOK_ARTIST_DEFAULTS = Object.freeze({
  type: 'Group',
  status: 'active',
  aliases: Object.freeze([]),
  links: Object.freeze([]),
  images: Object.freeze([]),
  albums: Object.freeze([])
})

const LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS = Object.freeze([
  'artistName',
  'id',
  'foreignArtistId',
  'status',
  'aliases',
  'links',
  'images',
  'albums'
])

const LIDARR_SKYHOOK_ARTIST_REQUIRED_KEYS = Object.freeze([
  'id',
  'foreignArtistId',
  'artistName',
  'disambiguation',
  'overview',
  'type',
  'status',
  'aliases',
  'links',
  'images',
  'albums'
])

function asString (value) {
  return value == null ? '' : String(value)
}

function normalizeStringArray (value) {
  return Array.isArray(value)
    ? value.map(item => asString(item).trim()).filter(Boolean)
    : []
}

function normalizeArray (value) {
  return Array.isArray(value) ? value : []
}

function withArtistLookupDefaults (artist = {}) {
  return {
    ...artist,
    artistName: asString(artist.artistName),
    id: asString(artist.id),
    foreignArtistId: asString(artist.foreignArtistId || artist.id),
    status: asString(artist.status || LIDARR_LOOKUP_ARTIST_DEFAULTS.status),
    aliases: normalizeStringArray(artist.aliases),
    links: normalizeArray(artist.links),
    images: normalizeArray(artist.images),
    albums: normalizeArray(artist.albums)
  }
}

function withSkyhookArtistDefaults (artist = {}) {
  return {
    ...artist,
    id: asString(artist.id),
    foreignArtistId: asString(artist.foreignArtistId || artist.id),
    artistName: asString(artist.artistName),
    disambiguation: asString(artist.disambiguation),
    overview: asString(artist.overview),
    type: asString(artist.type || LIDARR_SKYHOOK_ARTIST_DEFAULTS.type),
    status: asString(artist.status || LIDARR_SKYHOOK_ARTIST_DEFAULTS.status),
    aliases: normalizeStringArray(artist.aliases),
    links: normalizeArray(artist.links),
    images: normalizeArray(artist.images),
    albums: normalizeArray(artist.albums)
  }
}

module.exports = {
  LIDARR_LOOKUP_ARTIST_DEFAULTS,
  LIDARR_SKYHOOK_ARTIST_DEFAULTS,
  LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS,
  LIDARR_SKYHOOK_ARTIST_REQUIRED_KEYS,
  asString,
  normalizeStringArray,
  withArtistLookupDefaults,
  withSkyhookArtistDefaults
}

const LIDARR_LOOKUP_ARTIST_DEFAULTS = Object.freeze({
  status: 'continuing',
  oldIds: Object.freeze([]),
  aliases: Object.freeze([]),
  artistAliases: Object.freeze([]),
  links: Object.freeze([])
})

const LIDARR_SKYHOOK_ARTIST_DEFAULTS = Object.freeze({
  type: 'Group',
  status: 'active',
  oldIds: Object.freeze([]),
  aliases: Object.freeze([]),
  artistAliases: Object.freeze([]),
  links: Object.freeze([]),
  images: Object.freeze([]),
  albums: Object.freeze([])
})

const LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS = Object.freeze([
  'artistName',
  'id',
  'foreignArtistId',
  'status',
  'oldIds',
  'aliases',
  'artistAliases',
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
  'oldIds',
  'aliases',
  'artistAliases',
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

function normalizeAliases (artist) {
  const candidates = [
    artist.artistAliases,
    artist.ArtistAliases,
    artist.aliases,
    artist.Aliases
  ]

  for (const candidate of candidates) {
    const aliases = normalizeStringArray(candidate)
    if (aliases.length > 0) {
      return aliases
    }
  }

  return []
}

function isArtistLike (value) {
  return value && typeof value === 'object' && (
    Object.prototype.hasOwnProperty.call(value, 'artistName') ||
    Object.prototype.hasOwnProperty.call(value, 'foreignArtistId')
  )
}

function normalizeLidarrArtistResponse (value) {
  if (Array.isArray(value)) {
    return value.map(normalizeLidarrArtistResponse)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const normalized = {}
  for (const [key, item] of Object.entries(value)) {
    normalized[key] = normalizeLidarrArtistResponse(item)
  }

  if (isArtistLike(normalized)) {
    const aliases = normalizeAliases(normalized)
    normalized.oldIds = normalizeStringArray(normalized.oldIds || normalized.OldIds)
    normalized.aliases = aliases
    normalized.artistAliases = aliases
  }

  return normalized
}

function withArtistLookupDefaults (artist = {}) {
  return {
    ...artist,
    artistName: asString(artist.artistName),
    id: asString(artist.id),
    foreignArtistId: asString(artist.foreignArtistId || artist.id),
    status: asString(artist.status || LIDARR_LOOKUP_ARTIST_DEFAULTS.status),
    oldIds: normalizeStringArray(artist.oldIds || artist.OldIds),
    aliases: normalizeAliases(artist),
    artistAliases: normalizeAliases(artist),
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
    oldIds: normalizeStringArray(artist.oldIds || artist.OldIds),
    aliases: normalizeAliases(artist),
    artistAliases: normalizeAliases(artist),
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
  normalizeAliases,
  normalizeLidarrArtistResponse,
  normalizeStringArray,
  withArtistLookupDefaults,
  withSkyhookArtistDefaults
}

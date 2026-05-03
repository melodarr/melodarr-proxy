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

function normalizeReleaseStatuses (value) {
  const statuses = normalizeStringArray(value)
  return statuses.length > 0 ? statuses : ['Official']
}

function normalizeRating (value) {
  if (!value || typeof value !== 'object') {
    return { count: 0, value: 0 }
  }

  return {
    count: Number(value.count ?? value.votes ?? 0) || 0,
    value: Number(value.value ?? 0) || 0
  }
}

function normalizeRatings (value) {
  if (!value || typeof value !== 'object') {
    return { votes: 0, value: 0 }
  }

  return {
    votes: Number(value.votes ?? value.count ?? 0) || 0,
    value: Number(value.value ?? 0) || 0
  }
}

function normalizeAlbum (album = {}) {
  const type = asString(album.type || album.albumType || album.primaryType || 'Album')
  const releaseDate = asString(album.releaseDate || album.firstReleaseDate)
  const images = normalizeArray(album.images)

  return {
    ...album,
    id: asString(album.id || album.foreignAlbumId),
    oldIds: normalizeStringArray(album.oldIds || album.OldIds),
    title: asString(album.title || album.name || album.albumName),
    type,
    albumType: type,
    secondaryTypes: normalizeStringArray(album.secondaryTypes || album.SecondaryTypes),
    releaseStatuses: normalizeReleaseStatuses(album.releaseStatuses || album.ReleaseStatuses),
    rating: normalizeRating(album.rating || album.ratings),
    ratings: normalizeRatings(album.ratings || album.rating),
    releaseDate: releaseDate || null,
    releases: normalizeArray(album.releases),
    genres: normalizeStringArray(album.genres),
    media: normalizeArray(album.media),
    images,
    links: normalizeArray(album.links),
    remoteCover: asString(album.remoteCover || images[0]?.remoteUrl || images[0]?.url)
  }
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
    albums: normalizeArray(artist.albums).map(normalizeAlbum)
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
    albums: normalizeArray(artist.albums).map(normalizeAlbum)
  }
}

module.exports = {
  LIDARR_LOOKUP_ARTIST_DEFAULTS,
  LIDARR_SKYHOOK_ARTIST_DEFAULTS,
  LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS,
  LIDARR_SKYHOOK_ARTIST_REQUIRED_KEYS,
  asString,
  normalizeAliases,
  normalizeAlbum,
  normalizeLidarrArtistResponse,
  normalizeStringArray,
  withArtistLookupDefaults,
  withSkyhookArtistDefaults
}

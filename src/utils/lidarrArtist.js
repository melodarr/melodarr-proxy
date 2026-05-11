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
  'disambiguation',
  'overview',
  'status',
  'oldIds',
  'aliases',
  'artistAliases',
  'links',
  'images',
  'albums',
  'ratings',
  'rating'
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

const SKYHOOK_ARTIST_RESOURCE_KEYS = Object.freeze([
  'genres',
  'artistUrl',
  'overview',
  'type',
  'disambiguation',
  'id',
  'oldIds',
  'images',
  'links',
  'artistName',
  'artistAliases',
  'albums',
  'status',
  'rating'
])

const LIDARR_OPTIONAL_ARTIST_KEYS = Object.freeze([
  'qualityProfileId',
  'metadataProfileId',
  'monitored',
  'monitorNewItems',
  'folder',
  'rootFolderPath',
  'addOptions',
  'ended',
  'tags',
  'genres',
  'ratings',
  'rating',
  'path',
  'cleanName',
  'sortName'
])

const LIDARR_ADD_ARTIST_OPTIONAL_KEYS = Object.freeze([
  'qualityProfileId',
  'metadataProfileId',
  'monitored',
  'monitorNewItems',
  'folder',
  'rootFolderPath',
  'addOptions',
  'ended',
  'tags'
])

const SKYHOOK_ALBUM_REQUIRED_KEYS = Object.freeze([
  'artistId',
  'artists',
  'disambiguation',
  'overview',
  'id',
  'oldIds',
  'images',
  'links',
  'genres',
  'rating',
  'releaseDate',
  'releases',
  'secondaryTypes',
  'title',
  'type',
  'releaseStatuses'
])

const SKYHOOK_RELEASE_REQUIRED_KEYS = Object.freeze([
  'disambiguation',
  'country',
  'releaseDate',
  'id',
  'oldIds',
  'label',
  'media',
  'title',
  'status',
  'trackCount',
  'tracks'
])

const SKYHOOK_TRACK_REQUIRED_KEYS = Object.freeze([
  'artistId',
  'durationMs',
  'id',
  'oldIds',
  'recordingId',
  'oldRecordingIds',
  'trackName',
  'trackNumber',
  'trackPosition',
  'explicit',
  'mediumNumber'
])

const SKYHOOK_MEDIUM_REQUIRED_KEYS = Object.freeze([
  'name',
  'format',
  'position'
])

const SKYHOOK_IMAGE_REQUIRED_KEYS = Object.freeze([
  'coverType',
  'url',
  'height',
  'width'
])

const SKYHOOK_LINK_REQUIRED_KEYS = Object.freeze([
  'target',
  'type'
])

const SKYHOOK_RATING_REQUIRED_KEYS = Object.freeze([
  'count',
  'value'
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

function normalizeRatingResource (value) {
  const rating = normalizeRating(value)
  return {
    count: rating.count,
    value: rating.value
  }
}

function normalizeLookupImage (image = {}) {
  const url = asString(image.url || image.remoteUrl || image.Url || image.RemoteUrl)
  const remoteUrl = asString(image.remoteUrl || image.url || image.RemoteUrl || image.Url)

  return {
    coverType: asString(image.coverType || image.CoverType),
    url,
    remoteUrl
  }
}

function normalizeImageResource (image = {}) {
  const url = asString(image.url || image.remoteUrl || image.Url || image.RemoteUrl)
  return {
    coverType: asString(image.coverType || image.CoverType),
    url,
    height: Number(image.height ?? image.Height ?? 0) || 0,
    width: Number(image.width ?? image.Width ?? 0) || 0
  }
}

function normalizeProviderMetadata (providers) {
  return normalizeArray(providers)
    .map(provider => {
      if (!provider) {
        return null
      }

      const normalized = typeof provider === 'object'
        ? {
            name: asString(provider.name || provider.Name)
          }
        : {
            name: asString(provider)
          }

      if (typeof provider === 'object') {
        const score = Number(provider.score ?? provider.Score)
        if (Number.isFinite(score)) {
          normalized.score = score
        }

        const albumCount = Number(provider.albumCount ?? provider.AlbumCount)
        if (Number.isFinite(albumCount)) {
          normalized.albumCount = albumCount
        }
      }

      return normalized.name ? normalized : null
    })
    .filter(Boolean)
}

function normalizeLinkResource (link = {}) {
  return {
    target: asString(link.target || link.Target || link.url || link.Url),
    type: asString(link.type || link.Type || link.name || link.Name)
  }
}

function normalizeMediumResource (medium = {}) {
  return {
    name: asString(medium.name || medium.Name),
    format: asString(medium.format || medium.Format),
    position: Number(medium.position ?? medium.Position ?? 0) || 0
  }
}

function normalizeTrackResource (track = {}) {
  return {
    artistId: asString(track.artistId || track.ArtistId),
    durationMs: Number(track.durationMs ?? track.DurationMs ?? 0) || 0,
    id: asString(track.id || track.Id),
    oldIds: normalizeStringArray(track.oldIds || track.OldIds),
    recordingId: asString(track.recordingId || track.RecordingId),
    oldRecordingIds: normalizeStringArray(track.oldRecordingIds || track.OldRecordingIds),
    trackName: asString(track.trackName || track.TrackName),
    trackNumber: asString(track.trackNumber || track.TrackNumber),
    trackPosition: Number(track.trackPosition ?? track.TrackPosition ?? 0) || 0,
    explicit: Boolean(track.explicit || track.Explicit),
    mediumNumber: Number(track.mediumNumber ?? track.MediumNumber ?? 0) || 0
  }
}

function normalizeReleaseResource (release = {}) {
  return {
    disambiguation: asString(release.disambiguation || release.Disambiguation),
    country: normalizeStringArray(release.country || release.Country),
    releaseDate: asString(release.releaseDate || release.ReleaseDate) || null,
    id: asString(release.id || release.Id),
    oldIds: normalizeStringArray(release.oldIds || release.OldIds),
    label: normalizeStringArray(release.label || release.Label),
    media: normalizeArray(release.media || release.Media).map(normalizeMediumResource),
    title: asString(release.title || release.Title),
    status: asString(release.status || release.Status || 'Official'),
    trackCount: Number(release.trackCount ?? release.TrackCount ?? 0) || 0,
    tracks: normalizeArray(release.tracks || release.Tracks).map(normalizeTrackResource)
  }
}

function getAlbumId (album = {}) {
  return asString(
    album.id ||
    album.Id ||
    album.foreignAlbumId ||
    album.ForeignAlbumId ||
    album.ids?.musicbrainzReleaseGroupId ||
    album.ids?.musicbrainzAlbumId ||
    album.ids?.theAudioDbAlbumId ||
    album.ids?.itunesCollectionId ||
    album.ids?.discogsId
  )
}

function normalizeAlbumImages (album = {}) {
  const images = normalizeArray(album.images || album.Images)
  if (images.length > 0) {
    return images.map(normalizeLookupImage)
  }

  const imageUrl = asString(album.imageUrl || album.ImageUrl || album.remoteCover || album.RemoteCover)
  return imageUrl
    ? [normalizeLookupImage({ coverType: 'cover', url: imageUrl, remoteUrl: imageUrl })]
    : []
}

function normalizeAlbum (album = {}) {
  const type = asString(album.type || album.albumType || album.primaryType || 'Album')
  const releaseDate = asString(album.releaseDate || album.firstReleaseDate || album.year)
  const firstReleaseDate = asString(album.firstReleaseDate || album.releaseDate || album.year)
  const images = normalizeAlbumImages(album)

  const out = {
    id: getAlbumId(album),
    oldIds: normalizeStringArray(album.oldIds || album.OldIds),
    title: asString(album.title || album.name || album.albumName),
    type,
    albumType: type,
    secondaryTypes: normalizeStringArray(album.secondaryTypes || album.SecondaryTypes),
    releaseStatuses: normalizeReleaseStatuses(album.releaseStatuses || album.ReleaseStatuses),
    rating: normalizeRating(album.rating || album.ratings),
    ratings: normalizeRatings(album.ratings || album.rating),
    firstReleaseDate: firstReleaseDate || null,
    releaseDate: releaseDate || null,
    releases: normalizeArray(album.releases || album.Releases).map(normalizeReleaseResource),
    genres: normalizeStringArray(album.genres),
    media: normalizeArray(album.media),
    images,
    links: normalizeArray(album.links),
    remoteCover: images.length > 0
      ? asString(images[0].url || images[0].remoteUrl)
      : asString(album.remoteCover)
  }

  if ('artistId' in album) out.artistId = asString(album.artistId)
  if ('artists' in album) out.artists = normalizeArray(album.artists)
  if ('disambiguation' in album) out.disambiguation = asString(album.disambiguation)
  if ('overview' in album) out.overview = asString(album.overview)
  if ('providers' in album) out.providers = normalizeProviderMetadata(album.providers)
  if ('provider' in album) out.provider = album.provider
  if ('ids' in album) out.ids = album.ids
  if ('provenance' in album) out.provenance = album.provenance
  if ('imageProvider' in album) out.imageProvider = album.imageProvider

  return out
}

function toSkyhookArtistResource (artist = {}) {
  const id = asString(artist.id || artist.Id || artist.foreignArtistId)
  return {
    genres: normalizeStringArray(artist.genres || artist.Genres),
    artistUrl: asString(artist.artistUrl || artist.ArtistUrl || artist.aristUrl || artist.AristUrl),
    overview: asString(artist.overview || artist.Overview),
    type: asString(artist.type || artist.Type || LIDARR_SKYHOOK_ARTIST_DEFAULTS.type),
    disambiguation: asString(artist.disambiguation || artist.Disambiguation),
    id,
    oldIds: normalizeStringArray(artist.oldIds || artist.OldIds),
    images: normalizeArray(artist.images || artist.Images).map(normalizeImageResource),
    links: normalizeArray(artist.links || artist.Links).map(normalizeLinkResource),
    artistName: asString(artist.artistName || artist.ArtistName),
    artistAliases: normalizeAliases(artist),
    albums: normalizeArray(artist.albums || artist.Albums).map(toSkyhookAlbumResource),
    status: asString(artist.status || artist.Status || LIDARR_SKYHOOK_ARTIST_DEFAULTS.status),
    rating: normalizeRatingResource(artist.rating || artist.Rating || artist.ratings)
  }
}

function toSkyhookAlbumResource (album = {}) {
  const normalized = normalizeAlbum(album)
  return {
    artistId: asString(normalized.artistId),
    artists: normalizeArray(normalized.artists).map(toSkyhookArtistResource),
    disambiguation: asString(normalized.disambiguation),
    overview: asString(normalized.overview),
    id: asString(normalized.id),
    oldIds: normalizeStringArray(normalized.oldIds),
    images: normalizeArray(normalized.images).map(normalizeImageResource),
    links: normalizeArray(normalized.links).map(normalizeLinkResource),
    genres: normalizeStringArray(normalized.genres),
    rating: normalizeRatingResource(normalized.rating || normalized.ratings),
    releaseDate: asString(normalized.releaseDate) || null,
    releases: normalizeArray(normalized.releases).map(normalizeReleaseResource),
    secondaryTypes: normalizeStringArray(normalized.secondaryTypes),
    title: asString(normalized.title),
    type: asString(normalized.type || 'Album'),
    releaseStatuses: normalizeReleaseStatuses(normalized.releaseStatuses)
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

function isLidarrAddArtistPayload (artist = {}) {
  return LIDARR_ADD_ARTIST_OPTIONAL_KEYS.some(key => Object.prototype.hasOwnProperty.call(artist, key))
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
  const out = {
    artistName: asString(artist.artistName),
    id: asString(artist.id),
    foreignArtistId: asString(artist.foreignArtistId || artist.id),
    disambiguation: asString(artist.disambiguation),
    overview: asString(artist.overview),
    status: asString(artist.status || LIDARR_LOOKUP_ARTIST_DEFAULTS.status),
    oldIds: normalizeStringArray(artist.oldIds || artist.OldIds),
    aliases: normalizeAliases(artist),
    artistAliases: normalizeAliases(artist),
    links: normalizeArray(artist.links),
    images: normalizeArray(artist.images).map(normalizeLookupImage),
    albums: normalizeArray(artist.albums).map(normalizeAlbum),
    ratings: normalizeRatings(artist.ratings || artist.rating),
    rating: normalizeRating(artist.rating || artist.ratings)
  }

  if (isLidarrAddArtistPayload(artist)) {
    for (const key of LIDARR_ADD_ARTIST_OPTIONAL_KEYS) {
      if (Object.prototype.hasOwnProperty.call(artist, key)) out[key] = artist[key]
    }
  }

  if ('genres' in artist) out.genres = normalizeStringArray(artist.genres)

  if ('providers' in artist) out.providers = normalizeProviderMetadata(artist.providers)
  if ('partial' in artist) out.partial = artist.partial
  if ('warning' in artist) out.warning = artist.warning
  if ('schemaVersion' in artist) out.schemaVersion = artist.schemaVersion
  if ('debug' in artist) out.debug = artist.debug
  if ('_generatedAt' in artist) out._generatedAt = artist._generatedAt

  return out
}

function withSkyhookArtistDefaults (artist = {}) {
  const out = {
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
    albums: normalizeArray(artist.albums).map(normalizeAlbum),
    genres: normalizeStringArray(artist.genres),
    ratings: normalizeRatings(artist.ratings || artist.rating),
    rating: normalizeRating(artist.rating || artist.ratings)
  }

  for (const key of LIDARR_OPTIONAL_ARTIST_KEYS) {
    if (key !== 'ratings' && key !== 'rating' && key !== 'genres' && key in artist) out[key] = artist[key]
  }

  if ('providers' in artist) out.providers = artist.providers
  if ('partial' in artist) out.partial = artist.partial
  if ('warning' in artist) out.warning = artist.warning
  if ('schemaVersion' in artist) out.schemaVersion = artist.schemaVersion
  if ('debug' in artist) out.debug = artist.debug
  if ('_generatedAt' in artist) out._generatedAt = artist._generatedAt

  return out
}

module.exports = {
  LIDARR_LOOKUP_ARTIST_DEFAULTS,
  LIDARR_SKYHOOK_ARTIST_DEFAULTS,
  LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS,
  LIDARR_SKYHOOK_ARTIST_REQUIRED_KEYS,
  LIDARR_OPTIONAL_ARTIST_KEYS,
  SKYHOOK_ARTIST_RESOURCE_KEYS,
  SKYHOOK_ALBUM_REQUIRED_KEYS,
  SKYHOOK_RELEASE_REQUIRED_KEYS,
  SKYHOOK_TRACK_REQUIRED_KEYS,
  SKYHOOK_MEDIUM_REQUIRED_KEYS,
  SKYHOOK_IMAGE_REQUIRED_KEYS,
  SKYHOOK_LINK_REQUIRED_KEYS,
  SKYHOOK_RATING_REQUIRED_KEYS,
  asString,
  normalizeAliases,
  normalizeAlbum,
  normalizeLidarrArtistResponse,
  normalizeStringArray,
  toSkyhookAlbumResource,
  toSkyhookArtistResource,
  withArtistLookupDefaults,
  withSkyhookArtistDefaults
}

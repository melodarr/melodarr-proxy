// SkyHook search-result shape mapper.
//
// Lidarr's SkyHook proxy expects search results as a polymorphic array of
// discriminated unions: each item is either {"artist": {...}} or
// {"album": {...}}. If the proxy returns flat candidate objects, Lidarr's
// JSON deserializer fails before even inspecting any field — surfacing as
// "Invalid response received from LidarrAPI" in the UI.
//
// This module is a *pure* shape transformation — it does not enrich,
// validate, or fall back. Empty/missing fields become safe defaults so the
// deserializer always succeeds; whether Lidarr can actually USE a given
// result (e.g. add an artist) still depends on whether id is
// a real MBID, which is a provider-layer concern.

const {
  LIDARR_SKYHOOK_ARTIST_DEFAULTS,
  asString,
  normalizeStringArray,
  withSkyhookArtistDefaults
} = require('./lidarrArtist')

function pickArtistMbid (candidate) {
  return asString(candidate.id || candidate.ids?.musicbrainzArtistId)
}

function pickAlbumMbid (candidate) {
  return asString(candidate.ids?.musicbrainzReleaseGroupId || candidate.id)
}

function normalizeImages (candidate, coverType) {
  const out = []
  const images = Array.isArray(candidate.images) ? candidate.images : []

  for (const image of images) {
    if (typeof image === 'string') {
      if (image.trim()) {
        out.push({ coverType, url: image, remoteUrl: image })
      }
      continue
    }

    if (image && typeof image === 'object') {
      const url = asString(image.url || image.remoteUrl || image.imageUrl)
      if (url) {
        out.push({
          coverType: asString(image.coverType || coverType),
          url,
          remoteUrl: asString(image.remoteUrl || url)
        })
      }
    }
  }

  const imageUrl = asString(candidate.imageUrl || candidate.coverUrl)
  if (imageUrl && !out.some(image => image.url === imageUrl || image.remoteUrl === imageUrl)) {
    out.push({ coverType, url: imageUrl, remoteUrl: imageUrl })
  }

  return out
}

function buildNestedArtist (candidate, artistId) {
  return withSkyhookArtistDefaults({
    id: artistId,
    foreignArtistId: artistId,
    artistName: asString(candidate.artistName),
    disambiguation: asString(candidate.disambiguation),
    overview: '',
    aliases: candidate.aliases
  })
}

function wrapArtist (candidate) {
  return {
    artist: withSkyhookArtistDefaults({
      id: pickArtistMbid(candidate),
      foreignArtistId: pickArtistMbid(candidate),
      artistName: asString(candidate.artistName || candidate.match),
      disambiguation: asString(candidate.disambiguation),
      overview: '',
      images: normalizeImages(candidate, 'poster'),
      aliases: candidate.aliases
    })
  }
}

function wrapAlbum (candidate) {
  const albumId = pickAlbumMbid(candidate)
  const artistId = pickArtistMbid(candidate)
  const images = normalizeImages(candidate, 'cover')
  const releaseDate = asString(candidate.releaseDate || candidate.firstReleaseDate || candidate.year)
  return {
    album: {
      id: albumId,
      title: asString(candidate.match || candidate.albumName || candidate.title),
      disambiguation: asString(candidate.disambiguation),
      overview: asString(candidate.overview),
      artistId,
      monitored: false,
      anyReleaseOk: false,
      profileId: 0,
      duration: 0,
      albumType: asString(candidate.albumType || candidate.primaryType || 'Album'),
      secondaryTypes: normalizeStringArray(candidate.secondaryTypes),
      mediumCount: 0,
      ratings: { votes: 0, value: 0 },
      releaseDate,
      releases: [],
      genres: normalizeStringArray(candidate.genres),
      media: [],
      artist: buildNestedArtist(candidate, artistId),
      images,
      links: [],
      lastSearchTime: null,
      statistics: {
        albumCount: 0,
        songCount: 0,
        sizeOnDisk: 0,
        percentOfSongs: 0
      },
      addOptions: {},
      remoteCover: images[0]?.remoteUrl || images[0]?.url || '',
      artists: [
        {
          id: artistId,
          artistName: asString(candidate.artistName),
          disambiguation: asString(candidate.disambiguation)
        }
      ]
    }
  }
}

// Wrap an array of internal candidate objects into the SkyHook search
// discriminated-union shape.
function toSkyhookSearchShape (candidates, requestedType = 'all') {
  if (!Array.isArray(candidates)) return []
  const out = []
  const typeFilter = String(requestedType || 'all').toLowerCase()
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue
    const t = String(c.type || 'artist').toLowerCase()

    if (typeFilter === 'all') {
      if (t === 'artist') out.push(wrapArtist(c))
      else if (t === 'album') out.push(wrapAlbum(c))
    } else if (typeFilter === 'artist' && t === 'artist') {
      out.push(wrapArtist(c))
    } else if (typeFilter === 'album' && t === 'album') {
      out.push(wrapAlbum(c))
    }
  }
  return out
}

module.exports = {
  LIDARR_SKYHOOK_ARTIST_DEFAULTS,
  toSkyhookSearchShape
}

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
// result (e.g. add an artist) still depends on whether foreignArtistId is
// a real MBID, which is a provider-layer concern.

const ARTIST_DEFAULTS = {
  // Lidarr's ArtistType enum: Person | Group | Orchestra | Choir | Character | Other.
  // We don't know which from upstream candidates, so 'Group' is the safest
  // default — it's the most common and Lidarr accepts it for both bands and
  // solo acts without complaint.
  type: 'Group',
  // Lidarr's ArtistStatus enum: active | ended | split-up.
  status: 'active'
}

function asString (v) {
  return v == null ? '' : String(v)
}

function pickArtistMbid (candidate) {
  return asString(candidate.foreignArtistId || candidate.ids?.musicbrainzArtistId)
}

function pickAlbumMbid (candidate) {
  return asString(candidate.ids?.musicbrainzReleaseGroupId || candidate.foreignAlbumId)
}

function wrapArtist (candidate) {
  return {
    artist: {
      foreignArtistId: pickArtistMbid(candidate),
      artistName: asString(candidate.artistName || candidate.match),
      disambiguation: asString(candidate.disambiguation),
      overview: '',
      type: ARTIST_DEFAULTS.type,
      status: ARTIST_DEFAULTS.status,
      links: [],
      images: [],
      albums: []
    }
  }
}

function wrapAlbum (candidate) {
  return {
    album: {
      foreignAlbumId: pickAlbumMbid(candidate),
      title: asString(candidate.match || candidate.albumName),
      releaseDate: '',
      images: [],
      artist: {
        foreignArtistId: pickArtistMbid(candidate),
        artistName: asString(candidate.artistName),
        disambiguation: asString(candidate.disambiguation)
      }
    }
  }
}

// Wrap an array of internal candidate objects into the SkyHook search
// discriminated-union shape. Non-array input → []. Candidates whose `type`
// is neither 'artist' nor 'album' (e.g. 'song' from a recording lookup)
// are dropped, since SkyHook's search contract only models artists and
// albums.
function toSkyhookSearchShape (candidates) {
  if (!Array.isArray(candidates)) return []
  const out = []
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue
    const t = String(c.type || 'artist').toLowerCase()
    if (t === 'artist') out.push(wrapArtist(c))
    else if (t === 'album') out.push(wrapAlbum(c))
    // 'song' and any unknown type intentionally skipped.
  }
  return out
}

module.exports = { toSkyhookSearchShape }

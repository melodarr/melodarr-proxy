// Final validation gate — drop malformed artist/album items before they
// reach Lidarr.
//
// Four response shapes to handle:
//   - SkyHook-wrapped artist:  { artist: { artistName, foreignArtistId, ... } }
//   - SkyHook-wrapped album:   { album:  { title, artistId, ... } }
//   - Lookup unwrapped artist: { artistName, foreignArtistId, ... }
//   - Lookup unwrapped album:  { title, ... }
//
// An item is valid iff its shape-appropriate display field
// (artistName/title) is a non-empty trimmed string. For shapes that
// carry an upstream identifier, that identifier must also be non-empty:
//   - All artist shapes require a non-empty foreignArtistId (Lidarr
//     rejects artists with an empty ForeignArtistId).
//   - SkyHook-wrapped albums ({ album: { title, artistId } }) require a
//     non-empty artistId; albums without an upstream artist linkage would
//     be orphaned inside Lidarr.
//   - Unwrapped lookup-shape albums (top-level { title }) are accepted on
//     a non-empty title alone — no artistId check applies to that shape.

function nonEmptyString (v) {
  return typeof v === 'string' && v.trim().length > 0
}

function isValidArtist (item) {
  if (!item || typeof item !== 'object') return false

  // SkyHook wrapped artist.
  if (item.artist && typeof item.artist === 'object') {
    return nonEmptyString(item.artist.artistName) && nonEmptyString(item.artist.foreignArtistId)
  }

  // SkyHook wrapped album.
  if (item.album && typeof item.album === 'object') {
    return nonEmptyString(item.album.title) && nonEmptyString(item.album.artistId)
  }

  // Unwrapped lookup-shape artist (the /api/v1/artist/lookup contract).
  if ('artistName' in item) {
    return nonEmptyString(item.artistName) && nonEmptyString(item.foreignArtistId)
  }

  // Unwrapped lookup-shape album.
  if ('title' in item) {
    return nonEmptyString(item.title)
  }

  return false
}

module.exports = { isValidArtist }

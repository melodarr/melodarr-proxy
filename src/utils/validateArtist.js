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
// (artistName/title) is a non-empty trimmed string, AND the upstream
// identifier is present for shapes that provide one:
//   - Lidarr explicitly rejects artists with an empty ForeignArtistId.
//   - SkyHook-wrapped albums without an artistId have no upstream artist
//     linkage and would be orphaned inside Lidarr, so they are rejected
//     here too.

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

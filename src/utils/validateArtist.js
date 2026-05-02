// Final validation gate — drop malformed artist/album items before they
// reach Lidarr.
//
// Three response shapes to handle:
//   - SkyHook-wrapped artist:  { artist: { artistName, ... } }
//   - SkyHook-wrapped album:   { album:  { title, ... } }
//   - Lookup unwrapped artist: { artistName, id, ... }
//
// An item is valid iff its shape-appropriate display field
// (artistName/title) is a non-empty trimmed string. We intentionally do
// NOT validate id — empty is a legitimate signal that no
// canonical MBID exists, and Lidarr's search UI displays such results
// (it just can't add them as new artists). Synthesizing fake MBIDs
// to pass this check is explicitly forbidden — see the v0.3.42
// CHANGELOG note for the rationale.

function nonEmptyString (v) {
  return typeof v === 'string' && v.trim().length > 0
}

function isValidArtist (item) {
  if (!item || typeof item !== 'object') return false

  // SkyHook wrapped artist.
  if (item.artist && typeof item.artist === 'object') {
    return nonEmptyString(item.artist.artistName)
  }

  // SkyHook wrapped album.
  if (item.album && typeof item.album === 'object') {
    return nonEmptyString(item.album.title)
  }

  // Unwrapped lookup-shape artist (the /api/v1/artist/lookup contract).
  if ('artistName' in item) {
    return nonEmptyString(item.artistName)
  }

  // Unwrapped lookup-shape album.
  if ('title' in item) {
    return nonEmptyString(item.title)
  }

  return false
}

module.exports = { isValidArtist }

// Lidarr/Skyhook expects firstReleaseDate as a full ISO 8601 UTC timestamp
// (e.g. "1997-05-21T00:00:00Z"). Provider sources have varying precision:
//   iTunes      → full ISO ("1997-05-21T07:00:00Z")
//   MusicBrainz → YYYY, YYYY-MM, or YYYY-MM-DD
//   TheAudioDB  → year only ("1997")
//   Discogs     → year only ("1997")
//
// .NET's DateTime parser accepts most of these but year-only ("1997") is
// rejected as ambiguous — pad the missing components with Jan/01/midnight UTC
// so the response is always parseable.
function toIsoDate (value) {
  if (value === null || value === undefined || value === '') return ''
  const s = String(value).trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01T00:00:00Z`
  if (/^\d{4}$/.test(s)) return `${s}-01-01T00:00:00Z`
  return s
}

module.exports = { toIsoDate }

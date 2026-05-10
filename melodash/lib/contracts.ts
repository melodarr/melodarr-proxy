/**
 * Shared contract definitions for Lidarr Mirror diagnostic UI.
 *
 * These MUST match the backend serializers in src/utils/lidarrArtist.js.
 * The backend exports:
 *   - LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS  → Artist Lookup response shape
 *   - SKYHOOK_ARTIST_RESOURCE_KEYS        → Artist by ID response shape
 *   - SKYHOOK_ALBUM_REQUIRED_KEYS         → Album by ID response shape
 *
 * ⚠ IMPORTANT: If a backend serializer changes, update this file in the same PR.
 *   Run `grep -n 'SKYHOOK_ALBUM_REQUIRED_KEYS\|SKYHOOK_ARTIST_RESOURCE_KEYS\|LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS'
 *        src/utils/lidarrArtist.js` to cross-reference.
 */

export type ContractFieldDef = { key: string; required: boolean };

/* ────────────────────────────────────────────────────────────────────────────
   Artist Lookup — GET /api/v1/artist/lookup?term=…
   Backend source: LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS
   Response is an array; contract checks the first element.
   ──────────────────────────────────────────────────────────────────────── */

export const ARTIST_LOOKUP_CONTRACT: ContractFieldDef[] = [
  { key: "artistName", required: true },
  { key: "foreignArtistId", required: true },
  { key: "overview", required: false },
  { key: "images", required: false },
  { key: "albums", required: false },
  { key: "ratings", required: false },
];

/* ────────────────────────────────────────────────────────────────────────────
   Artist by ID — GET /api/v1/artist/{foreignArtistId}
   Backend source: SKYHOOK_ARTIST_RESOURCE_KEYS
   Response is a single object (toSkyhookArtistResource).
   ──────────────────────────────────────────────────────────────────────── */

export const ARTIST_BY_ID_CONTRACT: ContractFieldDef[] = [
  { key: "id", required: true },
  { key: "artistName", required: true },
  { key: "overview", required: false },
  { key: "images", required: true },
  { key: "albums", required: true },
  { key: "rating", required: false },
  { key: "links", required: false },
  { key: "genres", required: false },
];

/* ────────────────────────────────────────────────────────────────────────────
   Album by ID — GET /api/v1/album/{foreignAlbumId}
   Backend source: SKYHOOK_ALBUM_REQUIRED_KEYS
   Response is a single object (toSkyhookAlbumResource).
   ──────────────────────────────────────────────────────────────────────── */

export const ALBUM_BY_ID_CONTRACT: ContractFieldDef[] = [
  { key: "title", required: true },
  { key: "id", required: true },
  { key: "releases", required: false },
  { key: "artists", required: false },
  { key: "images", required: false },
  { key: "rating", required: false },
  { key: "genres", required: false },
];

/* ────────────────────────────────────────────────────────────────────────────
   Release Search — GET /api/v1/release
   Source-derived Lidarr ReleaseResource contract.
   Empty [] is valid when no indexer candidates exist.
   ──────────────────────────────────────────────────────────────────────── */

export const RELEASE_SEARCH_CONTRACT: ContractFieldDef[] = [
  { key: "age", required: true },
  { key: "ageHours", required: true },
  { key: "ageMinutes", required: true },
  { key: "airDate", required: true },
  { key: "albumTitle", required: true },
  { key: "approved", required: true },
  { key: "artistName", required: true },
  { key: "commentUrl", required: true },
  { key: "customFormatScore", required: true },
  { key: "customFormats", required: true },
  { key: "discography", required: true },
  { key: "downloadAllowed", required: true },
  { key: "downloadUrl", required: true },
  { key: "guid", required: true },
  { key: "id", required: true },
  { key: "indexer", required: true },
  { key: "indexerFlags", required: true },
  { key: "indexerId", required: true },
  { key: "infoHash", required: true },
  { key: "infoUrl", required: true },
  { key: "leechers", required: true },
  { key: "magnetUrl", required: true },
  { key: "protocol", required: true },
  { key: "publishDate", required: true },
  { key: "quality", required: true },
  { key: "qualityWeight", required: true },
  { key: "rejected", required: true },
  { key: "rejections", required: true },
  { key: "releaseGroup", required: true },
  { key: "releaseHash", required: true },
  { key: "releaseWeight", required: true },
  { key: "sceneSource", required: true },
  { key: "seeders", required: true },
  { key: "size", required: true },
  { key: "subGroup", required: true },
  { key: "temporarilyRejected", required: true },
  { key: "title", required: true },
  { key: "albumId", required: false },
  { key: "artistId", required: false },
  { key: "downloadClient", required: false },
  { key: "downloadClientId", required: false },
];

/* ────────────────────────────────────────────────────────────────────────────
   Queue Details — GET /api/v1/queue/details
   Source-derived Lidarr QueueResource contract.
   Empty [] is valid when no active/pending downloads exist.
   ──────────────────────────────────────────────────────────────────────── */

export const QUEUE_DETAILS_CONTRACT: ContractFieldDef[] = [
  { key: "added", required: true },
  { key: "album", required: true },
  { key: "albumId", required: true },
  { key: "artist", required: true },
  { key: "artistId", required: true },
  { key: "customFormatScore", required: true },
  { key: "customFormats", required: true },
  { key: "downloadClient", required: true },
  { key: "downloadClientHasPostImportCategory", required: true },
  { key: "downloadForced", required: true },
  { key: "downloadId", required: true },
  { key: "errorMessage", required: true },
  { key: "estimatedCompletionTime", required: true },
  { key: "id", required: true },
  { key: "indexer", required: true },
  { key: "outputPath", required: true },
  { key: "protocol", required: true },
  { key: "quality", required: true },
  { key: "size", required: true },
  { key: "sizeleft", required: true },
  { key: "status", required: true },
  { key: "statusMessages", required: true },
  { key: "timeleft", required: true },
  { key: "title", required: true },
  { key: "trackFileCount", required: true },
  { key: "trackHasFileCount", required: true },
  { key: "trackedDownloadState", required: true },
  { key: "trackedDownloadStatus", required: true },
];

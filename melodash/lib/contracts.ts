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
   Stub endpoint — returns []. Fields are aspirational.
   ──────────────────────────────────────────────────────────────────────── */

export const RELEASE_SEARCH_CONTRACT: ContractFieldDef[] = [
  { key: "guid", required: false },
  { key: "title", required: false },
  { key: "approved", required: false },
  { key: "rejections", required: false },
];

/* ────────────────────────────────────────────────────────────────────────────
   Queue Details — GET /api/v1/queue/details
   Stub endpoint — returns []. Fields are aspirational.
   ──────────────────────────────────────────────────────────────────────── */

export const QUEUE_DETAILS_CONTRACT: ContractFieldDef[] = [
  { key: "artistId", required: false },
  { key: "albumId", required: false },
  { key: "status", required: false },
  { key: "trackedDownloadStatus", required: false },
];

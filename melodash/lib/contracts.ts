/**
 * Shared contract definitions for Lidarr Mirror diagnostic UI.
 *
 * Source: Lidarr
 * Files:
 *   - src/Lidarr.Api.V1/Indexers/ReleaseResource.cs
 *   - src/Lidarr.Api.V1/Indexers/ReleaseController.cs
 *   - src/Lidarr.Api.V1/Queue/QueueResource.cs
 *   - src/Lidarr.Api.V1/Queue/QueueDetailsController.cs
 *
 * Commit:
 *   498de3fc51ff3297632b45560bab0e3c50e2c092
 *
 * Notes:
 *   Derived from serialized API DTOs, not database models.
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

export type ContractFieldKind = "source field" | "omitted when default";
export type ContractFieldDef = { key: string; kind: ContractFieldKind };

const sourceField = (key: string): ContractFieldDef => ({ key, kind: "source field" });
const omittedWhenDefault = (key: string): ContractFieldDef => ({ key, kind: "omitted when default" });

/* ────────────────────────────────────────────────────────────────────────────
   Artist Lookup — GET /api/v1/artist/lookup?term=…
   Backend source: LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS
   Response is an array; contract checks the first element.
   ──────────────────────────────────────────────────────────────────────── */

export const ARTIST_LOOKUP_CONTRACT: ContractFieldDef[] = [
  sourceField("artistName"),
  sourceField("foreignArtistId"),
  omittedWhenDefault("overview"),
  omittedWhenDefault("images"),
  omittedWhenDefault("albums"),
  omittedWhenDefault("ratings"),
];

/* ────────────────────────────────────────────────────────────────────────────
   Artist by ID — GET /api/v1/artist/{foreignArtistId}
   Backend source: SKYHOOK_ARTIST_RESOURCE_KEYS
   Response is a single object (toSkyhookArtistResource).
   ──────────────────────────────────────────────────────────────────────── */

export const ARTIST_BY_ID_CONTRACT: ContractFieldDef[] = [
  sourceField("id"),
  sourceField("artistName"),
  omittedWhenDefault("overview"),
  sourceField("images"),
  sourceField("albums"),
  omittedWhenDefault("rating"),
  omittedWhenDefault("links"),
  omittedWhenDefault("genres"),
];

/* ────────────────────────────────────────────────────────────────────────────
   Album by ID — GET /api/v1/album/{foreignAlbumId}
   Backend source: SKYHOOK_ALBUM_REQUIRED_KEYS
   Response is a single object (toSkyhookAlbumResource).
   ──────────────────────────────────────────────────────────────────────── */

export const ALBUM_BY_ID_CONTRACT: ContractFieldDef[] = [
  sourceField("title"),
  sourceField("id"),
  omittedWhenDefault("releases"),
  omittedWhenDefault("artists"),
  omittedWhenDefault("images"),
  omittedWhenDefault("rating"),
  omittedWhenDefault("genres"),
];

/* ────────────────────────────────────────────────────────────────────────────
   Release Search — GET /api/v1/release
   Source-derived Lidarr ReleaseResource contract.
   Empty [] is valid when no indexer candidates exist.
   ──────────────────────────────────────────────────────────────────────── */

export const RELEASE_SEARCH_CONTRACT: ContractFieldDef[] = [
  sourceField("age"),
  sourceField("ageHours"),
  sourceField("ageMinutes"),
  sourceField("airDate"),
  sourceField("albumTitle"),
  sourceField("approved"),
  sourceField("artistName"),
  sourceField("commentUrl"),
  sourceField("customFormatScore"),
  sourceField("customFormats"),
  sourceField("discography"),
  sourceField("downloadAllowed"),
  sourceField("downloadUrl"),
  sourceField("guid"),
  sourceField("id"),
  sourceField("indexer"),
  sourceField("indexerFlags"),
  sourceField("indexerId"),
  sourceField("infoHash"),
  sourceField("infoUrl"),
  sourceField("leechers"),
  sourceField("magnetUrl"),
  sourceField("protocol"),
  sourceField("publishDate"),
  sourceField("quality"),
  sourceField("qualityWeight"),
  sourceField("rejected"),
  sourceField("rejections"),
  sourceField("releaseGroup"),
  sourceField("releaseHash"),
  sourceField("releaseWeight"),
  sourceField("sceneSource"),
  sourceField("seeders"),
  sourceField("size"),
  sourceField("subGroup"),
  sourceField("temporarilyRejected"),
  sourceField("title"),
  omittedWhenDefault("albumId"),
  omittedWhenDefault("artistId"),
  omittedWhenDefault("downloadClient"),
  omittedWhenDefault("downloadClientId"),
];

/* ────────────────────────────────────────────────────────────────────────────
   Queue Details — GET /api/v1/queue/details
   Source-derived Lidarr QueueResource contract.
   Empty [] is valid when no active/pending downloads exist.
   ──────────────────────────────────────────────────────────────────────── */

export const QUEUE_DETAILS_CONTRACT: ContractFieldDef[] = [
  sourceField("added"),
  sourceField("album"),
  sourceField("albumId"),
  sourceField("artist"),
  sourceField("artistId"),
  sourceField("customFormatScore"),
  sourceField("customFormats"),
  sourceField("downloadClient"),
  sourceField("downloadClientHasPostImportCategory"),
  sourceField("downloadForced"),
  sourceField("downloadId"),
  sourceField("errorMessage"),
  sourceField("estimatedCompletionTime"),
  sourceField("id"),
  sourceField("indexer"),
  sourceField("outputPath"),
  sourceField("protocol"),
  sourceField("quality"),
  sourceField("size"),
  sourceField("sizeleft"),
  sourceField("status"),
  sourceField("statusMessages"),
  sourceField("timeleft"),
  sourceField("title"),
  sourceField("trackFileCount"),
  sourceField("trackHasFileCount"),
  sourceField("trackedDownloadState"),
  sourceField("trackedDownloadStatus"),
];

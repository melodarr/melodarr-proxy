/**
 * Phase 2 scaffold only.
 *
 * Source: Lidarr API resource DTOs
 * Commit: 498de3fc51ff3297632b45560bab0e3c50e2c092
 *
 * These interfaces document the client-visible API resources we validate with
 * golden fixtures. Backend runtime code is intentionally not wired to these
 * TypeScript interfaces yet.
 */

export interface LidarrQuality {
  id: number;
  name: string | null;
}

export interface LidarrRevision {
  version: number;
  real: number;
  isRepack: boolean;
}

export interface LidarrQualityModel {
  quality: LidarrQuality;
  revision: LidarrRevision;
}

export interface LidarrCustomFormatResource {
  id: number;
  name: string | null;
  includeCustomFormatWhenRenaming?: boolean | null;
  specifications?: unknown[] | null;
}

export interface ReleaseResource {
  id: number;
  guid: string | null;
  quality: LidarrQualityModel;
  qualityWeight: number;
  age: number;
  ageHours: number;
  ageMinutes: number;
  size: number;
  indexerId: number;
  indexer: string | null;
  releaseGroup: string | null;
  subGroup: string | null;
  releaseHash: string | null;
  title: string | null;
  discography: boolean;
  sceneSource: boolean;
  airDate: string | null;
  artistName: string | null;
  albumTitle: string | null;
  approved: boolean;
  temporarilyRejected: boolean;
  rejected: boolean;
  rejections: string[];
  publishDate: string;
  commentUrl: string | null;
  downloadUrl: string | null;
  infoUrl: string | null;
  downloadAllowed: boolean;
  releaseWeight: number;
  customFormats: LidarrCustomFormatResource[];
  customFormatScore: number;
  magnetUrl: string | null;
  infoHash: string | null;
  seeders: number | null;
  leechers: number | null;
  protocol: "unknown" | "usenet" | "torrent";
  indexerFlags: number;
  artistId?: number;
  albumId?: number;
  downloadClientId?: number;
  downloadClient?: string;
}

export interface QueueStatusMessage {
  title: string | null;
  messages: string[] | null;
}

export interface QueueResource {
  id: number;
  artistId: number | null;
  albumId: number | null;
  artist: unknown | null;
  album: unknown | null;
  quality: LidarrQualityModel;
  customFormats: LidarrCustomFormatResource[] | null;
  customFormatScore: number;
  size: number;
  title: string | null;
  sizeleft: number;
  timeleft: string | null;
  estimatedCompletionTime: string | null;
  added: string | null;
  status: string | null;
  trackedDownloadStatus: "ok" | "warning" | "error" | null;
  trackedDownloadState:
    | "downloading"
    | "downloadFailed"
    | "downloadFailedPending"
    | "importBlocked"
    | "importPending"
    | "importing"
    | "importFailed"
    | "imported"
    | "ignored"
    | null;
  statusMessages: QueueStatusMessage[] | null;
  errorMessage: string | null;
  downloadId: string | null;
  protocol: "unknown" | "usenet" | "torrent";
  downloadClient: string | null;
  downloadClientHasPostImportCategory: boolean;
  indexer: string | null;
  outputPath: string | null;
  trackFileCount: number;
  trackHasFileCount: number;
  downloadForced: boolean;
}

/**
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
 *   Fixture values mirror src/fixtures/lidarr/*.golden.json and are validated
 *   by melodash/tests/lidarr-fixture-contract.test.ts.
 */

export const mockReleaseResults = [
  {
    id: 0,
    guid: "indexer-1-guid-approved",
    quality: {
      quality: {
        id: 6,
        name: "FLAC",
      },
      revision: {
        version: 1,
        real: 0,
        isRepack: false,
      },
    },
    qualityWeight: 2200,
    age: 1,
    ageHours: 26.5,
    ageMinutes: 1590,
    size: 456789123,
    indexerId: 12,
    indexer: "Test Indexer",
    releaseGroup: "TEST",
    subGroup: null,
    releaseHash: "ABCDEF1234567890",
    title: "Radiohead - OK Computer (1997) [FLAC]",
    discography: false,
    sceneSource: false,
    airDate: null,
    artistName: "Radiohead",
    albumTitle: "OK Computer",
    approved: true,
    temporarilyRejected: false,
    rejected: false,
    rejections: [],
    publishDate: "2026-05-01T12:00:00Z",
    commentUrl: "https://indexer.example/details/indexer-1-guid-approved",
    downloadUrl: "https://indexer.example/download/indexer-1-guid-approved",
    infoUrl: "https://indexer.example/info/indexer-1-guid-approved",
    downloadAllowed: true,
    releaseWeight: 0,
    customFormats: [],
    customFormatScore: 0,
    magnetUrl: null,
    infoHash: null,
    seeders: null,
    leechers: null,
    protocol: "usenet",
    indexerFlags: 0,
  },
  {
    id: 0,
    guid: "indexer-2-guid-torrent",
    quality: {
      quality: {
        id: 6,
        name: "FLAC",
      },
      revision: {
        version: 2,
        real: 1,
        isRepack: true,
      },
    },
    qualityWeight: 2212,
    age: 0,
    ageHours: 2.5,
    ageMinutes: 150,
    size: 567891234,
    indexerId: 22,
    indexer: "Torrent Indexer",
    releaseGroup: "INTERNAL",
    subGroup: "vinyl",
    releaseHash: "1234567890ABCDEF",
    title: "Radiohead - OK Computer (1997) [FLAC] [REPACK]",
    discography: false,
    sceneSource: false,
    airDate: null,
    artistName: "Radiohead",
    albumTitle: "OK Computer",
    approved: false,
    temporarilyRejected: true,
    rejected: false,
    rejections: ["Indexer unavailable, retry later"],
    publishDate: "2026-05-02T09:30:00Z",
    commentUrl: "https://tracker.example/torrent/indexer-2-guid-torrent",
    downloadUrl: "https://tracker.example/download/indexer-2-guid-torrent",
    infoUrl: "https://tracker.example/info/indexer-2-guid-torrent",
    downloadAllowed: false,
    releaseWeight: 1,
    customFormats: [
      {
        id: 3,
        name: "Lossless Preferred",
      },
    ],
    customFormatScore: 10,
    magnetUrl: "magnet:?xt=urn:btih:1234567890ABCDEF",
    infoHash: "1234567890ABCDEF",
    seeders: 42,
    leechers: 7,
    protocol: "torrent",
    indexerFlags: 9,
    artistId: 700,
    albumId: 6271,
    downloadClientId: 2,
    downloadClient: "Transmission",
  },
];

export const mockQueueDetails = [
  {
    id: 101,
    artistId: 700,
    albumId: 6271,
    artist: null,
    album: {
      id: 6271,
      title: "Millennium",
      disambiguation: "",
      overview: "",
      artistId: 700,
      foreignAlbumId: "920a68fe-7b93-3d0e-bf73-44ac72f03dd2",
      monitored: true,
      anyReleaseOk: false,
      profileId: 1,
      duration: 2820,
      albumType: "Album",
      secondaryTypes: [],
      mediumCount: 1,
      ratings: {
        votes: 0,
        value: 0,
      },
      releaseDate: "1999-05-18T00:00:00Z",
      releases: [],
      genres: [],
      media: [],
      artist: null,
      images: [],
      links: [],
      lastSearchTime: null,
      statistics: {
        trackFileCount: 0,
        trackCount: 12,
        totalTrackCount: 12,
        sizeOnDisk: 0,
        percentOfTracks: 0,
      },
      addOptions: {},
      remoteCover: null,
    },
    quality: {
      quality: {
        id: 1,
        name: "MP3-320",
      },
      revision: {
        version: 1,
        real: 0,
        isRepack: false,
      },
    },
    customFormats: [],
    customFormatScore: 0,
    size: 123456789,
    title: "Backstreet Boys - Millennium",
    sizeleft: 456789,
    timeleft: "00:12:34",
    estimatedCompletionTime: "2026-05-04T05:00:00Z",
    added: "2026-05-04T04:30:00Z",
    status: "downloading",
    trackedDownloadStatus: "ok",
    trackedDownloadState: "downloading",
    statusMessages: [
      {
        title: "Import pending",
        messages: ["Waiting for download client to finish"],
      },
    ],
    errorMessage: null,
    downloadId: "transmission-queue-id-101",
    protocol: "torrent",
    downloadClient: "Transmission",
    downloadClientHasPostImportCategory: false,
    indexer: "Manual",
    outputPath: "/downloads/Backstreet Boys - Millennium",
    trackFileCount: 12,
    trackHasFileCount: 0,
    downloadForced: false,
  },
];

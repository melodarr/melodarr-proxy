# Lidarr Source Map

This document tracks the exact C# contracts that Lidarr expects for communication. All Melodarr proxy payloads MUST strictly map to these models to ensure full compatibility.

## 1. ArtistResource (`Lidarr.Api.V1.Artist.ArtistResource`)

**Source:** `Lidarr.Api.V1/Artist/ArtistResource.cs`

| Field | Type | Nullability | Serialization Quirks | Notes |
|-------|------|-------------|----------------------|-------|
| `Id` | `int` | Non-null | Base `RestResource` | Base model field |
| `ArtistMetadataId` | `int` | Non-null | `[JsonIgnore]` | Internal Lidarr mapping ID |
| `Status` | `ArtistStatusType` (enum) | Non-null | | Enum (e.g., `Ended`, `Continuing`) |
| `Ended` | `bool` | Non-null | Getter only | Calculated from `Status` |
| `ArtistName` | `string` | Nullable | | |
| `ForeignArtistId` | `string` | Nullable | | Usually MusicBrainz ID |
| `MBId` | `string` | Nullable | | MusicBrainz ID explicitly |
| `TADBId` | `int` | Non-null | | TheAudioDb ID |
| `DiscogsId` | `int` | Non-null | | Discogs ID |
| `AllMusicId` | `string` | Nullable | | AllMusic ID |
| `Overview` | `string` | Nullable | | |
| `ArtistType` | `string` | Nullable | | e.g. "Person", "Group" |
| `Disambiguation` | `string` | Nullable | | |
| `Links` | `List<Links>` | Nullable | | Structure: `[{ url, name }]` |
| `NextAlbum` | `AlbumResource` | Nullable | `[JsonIgnore(Condition = JsonIgnoreCondition.Never)]` | **Must always be serialized**, even if null |
| `LastAlbum` | `AlbumResource` | Nullable | `[JsonIgnore(Condition = JsonIgnoreCondition.Never)]` | **Must always be serialized**, even if null |
| `Images` | `List<MediaCover>` | Nullable | | Structure: `[{ coverType, url, remoteUrl }]` |
| `Members` | `List<Member>` | Nullable | | |
| `RemotePoster` | `string` | Nullable | | |
| `Path` | `string` | Nullable | | Absolute file path |
| `QualityProfileId` | `int` | Non-null | | Required for DB save |
| `MetadataProfileId`| `int` | Non-null | | Required for DB save |
| `Monitored` | `bool` | Non-null | | |
| `MonitorNewItems` | `NewItemMonitorTypes` | Non-null | | Enum (e.g., `All`, `None`) |
| `RootFolderPath` | `string` | Nullable | | Used when adding |
| `Folder` | `string` | Nullable | | |
| `Genres` | `List<string>` | Nullable | | List of strings |
| `CleanName` | `string` | Nullable | | |
| `SortName` | `string` | Nullable | | |
| `Tags` | `HashSet<int>` | Nullable | | List of integers |
| `Added` | `DateTime` | Non-null | | |
| `AddOptions` | `AddArtistOptions` | Nullable | | Used for additions (search/monitor options) |
| `Ratings` | `Ratings` | Nullable | | Structure: `[{ votes, value }]` |
| `Statistics` | `ArtistStatisticsResource` | Nullable | | Size/Track statistics |

---

## 2. AlbumResource (`Lidarr.Api.V1.Albums.AlbumResource`)

**Source:** `Lidarr.Api.V1/Albums/AlbumResource.cs`

| Field | Type | Nullability | Serialization Quirks | Notes |
|-------|------|-------------|----------------------|-------|
| `Id` | `int` | Non-null | Base `RestResource` | Base model field |
| `Title` | `string` | Nullable | | |
| `Disambiguation` | `string` | Nullable | | |
| `Overview` | `string` | Nullable | | |
| `ArtistId` | `int` | Non-null | | Parent reference |
| `ForeignAlbumId` | `string` | Nullable | | Usually MusicBrainz release-group ID |
| `Monitored` | `bool` | Non-null | | |
| `AnyReleaseOk` | `bool` | Non-null | | |
| `ProfileId` | `int` | Non-null | | |
| `Duration` | `int` | Non-null | | Milliseconds/seconds? (int) |
| `AlbumType` | `string` | Nullable | | e.g. "Album", "EP", "Single" |
| `SecondaryTypes` | `List<string>` | Nullable | | e.g. "Compilation", "Live" |
| `MediumCount` | `int` | Non-null | Getter only | Calculated from `Media` |
| `Ratings` | `Ratings` | Nullable | | |
| `ReleaseDate` | `DateTime?` | Nullable | | |
| `Releases` | `List<AlbumReleaseResource>`| Nullable | | All releases/pressings mapped |
| `Genres` | `List<string>` | Nullable | | |
| `Media` | `List<MediumResource>`| Nullable | | |
| `Artist` | `ArtistResource` | Nullable | | Full nested artist model (often populated) |
| `Images` | `List<MediaCover>` | Nullable | | |
| `Links` | `List<Links>` | Nullable | | |
| `LastSearchTime` | `DateTime?` | Nullable | | |
| `Statistics` | `AlbumStatisticsResource` | Nullable | | |
| `AddOptions` | `AddAlbumOptions` | Nullable | | |
| `RemoteCover` | `string` | Nullable | | |
| `Grabbed` | `bool` | Non-null | `[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]`, `[SwaggerIgnore]` | Hidden on default (`false`) |

---

## 3. AlbumReleaseResource (`Lidarr.Api.V1.Albums.AlbumReleaseResource`)

**Source:** `Lidarr.Api.V1/Albums/AlbumReleaseResource.cs`

| Field | Type | Nullability | Serialization Quirks | Notes |
|-------|------|-------------|----------------------|-------|
| `Id` | `int` | Non-null | | |
| `AlbumId` | `int` | Non-null | | Parent album ID |
| `ForeignReleaseId` | `string` | Nullable | | Usually MusicBrainz release ID |
| `Title` | `string` | Nullable | | |
| `Status` | `string` | Nullable | | e.g. "Official", "Bootleg" |
| `Duration` | `int` | Non-null | | |
| `TrackCount` | `int` | Non-null | | |
| `Media` | `List<MediumResource>`| Nullable | | |
| `MediumCount` | `int` | Non-null | Getter only | |
| `Disambiguation` | `string` | Nullable | | |
| `Country` | `List<string>` | Nullable | | List of country ISO codes |
| `Label` | `List<string>` | Nullable | | |
| `Format` | `string` | Nullable | | Generated via `MediaFormatHelper` (e.g. "CD", "2xVinyl") |
| `Monitored` | `bool` | Non-null | | |

---

## 4. QueueResource (`Lidarr.Api.V1.Queue.QueueResource`)

**Source:** `Lidarr.Api.V1/Queue/QueueResource.cs`

| Field | Type | Nullability | Serialization Quirks | Notes |
|-------|------|-------------|----------------------|-------|
| `Id` | `int` | Non-null | Base `RestResource` | Base model field |
| `ArtistId` | `int?` | Nullable | | |
| `AlbumId` | `int?` | Nullable | | |
| `Artist` | `ArtistResource` | Nullable | | Nested artist resource |
| `Album` | `AlbumResource` | Nullable | | Nested album resource |
| `Quality` | `QualityModel` | Nullable | | Nested quality definition |
| `CustomFormats` | `List<CustomFormatResource>` | Nullable | | |
| `CustomFormatScore`| `int` | Non-null | | |
| `Size` | `decimal` | Non-null | | Total byte size |
| `Title` | `string` | Nullable | | Release title in queue |
| `Sizeleft` | `decimal` | Non-null | | Bytes remaining |
| `Timeleft` | `TimeSpan?` | Nullable | | Represented as "00:00:00" in JSON |
| `EstimatedCompletionTime` | `DateTime?` | Nullable | | |
| `Added` | `DateTime?` | Nullable | | |
| `Status` | `string` | Nullable | | String status (lowercased) |
| `TrackedDownloadStatus` | `TrackedDownloadStatus?` | Nullable | | Enum (Warning, Ok, Error) |
| `TrackedDownloadState` | `TrackedDownloadState?` | Nullable | | Enum (Downloading, Importing) |
| `StatusMessages` | `List<TrackedDownloadStatusMessage>` | Nullable | | |
| `ErrorMessage` | `string` | Nullable | | |
| `DownloadId` | `string` | Nullable | | Identifier from download client |
| `Protocol` | `DownloadProtocol` | Non-null | | Usenet or Torrent |
| `DownloadClient` | `string` | Nullable | | Name of client (e.g., SABnzbd) |
| `DownloadClientHasPostImportCategory` | `bool` | Non-null | | |
| `Indexer` | `string` | Nullable | | Name of indexer |
| `OutputPath` | `string` | Nullable | | |
| `TrackFileCount` | `int` | Non-null | | Number of tracks |
| `TrackHasFileCount`| `int` | Non-null | | Number of tracks downloaded |
| `DownloadForced` | `bool` | Non-null | | |

---

## 5. Command Endpoints (Search, Import, Metadata Refresh)

Lidarr executes these operations asynchronously via `POST /api/v1/command`. The request body requires a `name` field corresponding to the command class name (without the "Command" suffix), along with command-specific arguments.

### Search Commands

* **AlbumSearch**
  * **Payload:** `{"name": "AlbumSearch", "albumIds": [1, 2, 3]}`
  * **Description:** Triggers a search for the specified album IDs.
* **ArtistSearch**
  * **Payload:** `{"name": "ArtistSearch", "artistId": 123}`
  * **Description:** Triggers a search for all missing/wanted albums for a specific artist.

### Import Commands

* **DownloadedAlbumsScan**
  * **Payload:** `{"name": "DownloadedAlbumsScan", "path": "/downloads/music/foo", "downloadClientId": "sabnzbd", "importMode": "Auto"}`
  * **Description:** Instructs Lidarr to scan a specific folder for downloaded tracks to import. `path` is the absolute path to scan.

### Metadata Refresh Commands

* **RefreshArtist**
  * **Payload:** `{"name": "RefreshArtist", "artistId": 123}`
  * **Description:** Refreshes metadata for a specific artist from the upstream provider. If `artistId` is omitted, it refreshes all artists.
* **RefreshAlbum**
  * **Payload:** `{"name": "RefreshAlbum", "albumId": 123}`
  * **Description:** Refreshes metadata for a specific album.

### General Endpoint Mapping

* **URL:** `POST /api/v1/command`
* **Response Type:** `CommandResource` (returns immediately with `Status: "queued"`)
* **Tracking:** Poll `GET /api/v1/command/{id}` to check for `Status: "completed"` or `Status: "failed"`.

---

## Development Constraints

1. **Nullability Checks:** Never map a nullable List as `null` if Lidarr expects an empty array `[]` in the database format. Payloads to the frontend should correctly preserve `null` if Lidarr does, but `Genres`, `Tags`, and `Images` often default to empty lists.
2. **Never Drop Fields:** If a field is `[JsonIgnore(Condition = JsonIgnoreCondition.Never)]` (e.g., `LastAlbum`), it **must** be serialized explicitly as `null` if missing. Missing properties violate the strict contract.
3. **Exact Field Names:** C# `TitleCase` gets serialized by Lidarr's JSON.Net setup into `camelCase`. Ensure all JSON mappings match the emitted camelCase format exact to Lidarr's API responses.

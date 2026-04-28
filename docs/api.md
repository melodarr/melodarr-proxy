# API Reference

This API is intentionally small and not yet a complete Lidarr metadata-server replacement.

## Authentication

Proxy endpoints accept either:

- an authenticated admin browser session, used by the built-in test UI
- an API key, used by Lidarr or scripts

Send API keys with:

```http
X-Api-Key: mp_...
```

For clients that cannot set custom headers, `api_key` and `apikey` query parameters are also accepted.

## Health

### `GET /api/health`

Returns service health.

```json
{
  "status": "ok",
  "proxy": "running",
  "upstream": "reachable",
  "cache": "healthy"
}
```

## Artist Lookup

### `GET /api/v1/artist/lookup?term={artist}`

Looks up an artist, merges configured metadata providers, caches the normalized response, and returns album-level metadata.

Response headers:

| Header | Description |
| --- | --- |
| `X-Cache` | `HIT` or `MISS` |
| `X-Upstream-Calls` | Number of upstream provider calls for cache misses |
| `X-Providers` | Comma-separated provider names used in the response |

Response body:

```json
{
  "artistName": "Radiohead",
  "foreignArtistId": "",
  "providers": [
    {
      "name": "musicbrainz",
      "score": 100,
      "albumCount": 18
    }
  ],
  "albums": [
    {
      "title": "OK Computer",
      "id": "b1392450-e666-3926-a536-22c65f834433",
      "firstReleaseDate": "1997",
      "coverUrl": "https://coverartarchive.org/release-group/b1392450-e666-3926-a536-22c65f834433/front-250",
      "provider": "musicbrainz",
      "ids": {
        "musicbrainzReleaseGroupId": "b1392450-e666-3926-a536-22c65f834433"
      }
    }
  ],
  "partial": false,
  "warning": null,
  "confidence": 100
}
```

## Stats

### `GET /api/stats`

Requires admin session. Returns runtime counters, cache stats, provider stats, API-key stats, and the last artist lookup.

Provider stats include:

```json
{
  "providers": {
    "musicbrainz": {
      "calls": 1,
      "errors": 0,
      "avgLatencyMs": 450,
      "errorRate": 0
    }
  }
}
```

## API Key Admin

Requires admin session.

### `POST /api/admin/keys/create`

Request:

```json
{
  "name": "Lidarr",
  "quota": 60
}
```

Response:

```json
{
  "id": "a1b2c3d4e5f6",
  "key": "mp_...",
  "message": "API key generated successfully. Please store it safely as it will not be shown again."
}
```

The raw key is shown once.

### `GET /api/admin/keys`

Lists stored API keys without exposing raw key values.

### `DELETE /api/admin/keys/:id`

Revokes an API key by ID.

## Errors

Common errors:

| Status | Meaning |
| --- | --- |
| `400` | Missing or invalid request input |
| `401` | Missing admin session or API key |
| `403` | Invalid API key |
| `429` | API key quota exceeded |
| `502` | All metadata providers failed |

# Melodarr Proxy

Lightweight MusicBrainz-backed metadata proxy for Melodarr. Can also be used with [Lidarr](https://lidarr.audio). Avoids the full MusicBrainz database and Solr stack by using live MusicBrainz lookups plus aggressive Redis caching.

## Endpoints

### `GET /health`

Returns service status:

```json
{
  "status": "ok",
  "cache": "ok"
}
```

### `GET /api/v1/artist/lookup?term={name}`

Checks Redis first, then performs at most two upstream MusicBrainz calls. Calls to MusicBrainz are queued by the proxy so they are paced at roughly one request per second by default.

1. `/artist?query=...`
2. `/release-group?artist=...`

Response:

```json
{
  "artistName": "Radiohead",
  "foreignArtistId": "a74b1b7f-71a5-4011-9441-d0b5e4122711",
  "albums": [
    {
      "title": "OK Computer",
      "id": "b1392450-e666-3926-a536-22c65f834433",
      "firstReleaseDate": "1997-05-21"
    }
  ]
}
```

### `GET /api/stats`

Returns in-memory runtime counters for requests, artist lookups, cache hits, upstream calls, slow requests, and the last artist lookup.

## Run With Docker

Set `APP_USER_AGENT` to include real contact information before public use.

Keep personal contact details out of git by putting them in your local `.env` file:

```bash
cp .env.example .env
```

Then edit `.env`:

```env
APP_USER_AGENT=melodarr-proxy/0.1.0 (your-contact@example.com)
```

```bash
docker compose up --build
```

Docker assigns a free host port by default. Find it with:

```bash
docker compose port proxy 3000
```

Then test with the returned host/port:

```bash
curl "http://localhost:<assigned-port>/health"
curl "http://localhost:<assigned-port>/api/v1/artist/lookup?term=Radiohead"
```

Open the app in your browser:

```text
http://localhost:<assigned-port>/login.html
```

On first run, this page prompts you to create the local admin password. After login, the app pages are available:

```text
http://localhost:<assigned-port>/
```

Runtime stats are available at:

```text
http://localhost:<assigned-port>/stats.html
```

Settings are available at:

```text
http://localhost:<assigned-port>/settings.html
```

The password is stored as a hash in the `melodarr_proxy_data` Docker volume. You can still override it with `ADMIN_PASSWORD` and `SETTINGS_SESSION_SECRET` environment variables if you prefer environment-only configuration.

To force a specific host port, set `HOST_PORT`:

```bash
HOST_PORT=3100 docker compose up --build
```

## Local Development

```bash
npm install
REDIS_URL=redis://localhost:6379 npm start
```

## Configuration

| Variable | Default |
| --- | --- |
| `PORT` | `3000` |
| `REDIS_URL` | `redis://localhost:6379` |
| `APP_USER_AGENT` | placeholder service user agent |
| `DATA_DIR` | `./data` locally, `/data` in Docker |
| `ADMIN_PASSWORD` | unset |
| `SETTINGS_SESSION_SECRET` | falls back to `ADMIN_PASSWORD` |
| `MUSICBRAINZ_BASE_URL` | `https://musicbrainz.org/ws/2` |
| `MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS` | `1100` |
| `CACHE_TTL_SECONDS` | `86400` |
| `UPSTREAM_TIMEOUT_MS` | `8000` |
| `SLOW_REQUEST_MS` | `2000` |

## Notes

- This is a lightweight metadata proxy for personal Melodarr setups.
- Artist lookup caches the complete normalized response at `artist:{searchTerm}` for at least 24 hours.
- Release and track expansion are intentionally omitted in the first version to keep upstream calls low.
- MusicBrainz requires a meaningful User-Agent such as `ApplicationName/version (contact-url-or-email)`. Configure this with `APP_USER_AGENT`.

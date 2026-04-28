# Lidarr Setup

Melodarr Proxy is experimental as a Lidarr metadata-server replacement. Start with a test Lidarr instance or a small library before pointing production automation at it.

## 1. Start Melodarr Proxy

With Docker Compose:

```bash
docker compose up -d
docker compose port proxy 3000
```

With the published image:

```bash
docker run -d \
  --name melodarr-proxy \
  --restart unless-stopped \
  -p 3055:3000 \
  -e APP_CONTACT=you@example.com \
  -e METADATA_PROVIDERS=musicbrainz,itunes \
  ghcr.io/melodarr/melodarr-proxy:v0.1.0
```

Open the web UI and create the first-run admin password:

```text
http://<proxy-host>:3055
```

## 2. Create an API Key

In Melodarr Proxy:

1. Sign in as admin.
2. Open Settings.
3. Create an API key named `Lidarr`.
4. Store the generated key. It is only shown once.

## 3. Verify Lookup Manually

Use the API key from the previous step:

```bash
curl \
  -H "X-Api-Key: mp_your_key_here" \
  "http://<proxy-host>:3055/api/v1/artist/lookup?term=radiohead"
```

Expected behavior:

- first request may be slow because providers are queried live
- response includes `artistName`, `foreignArtistId`, `providers`, and `albums`
- repeated request should return with `X-Cache: HIT`

## 4. Point Lidarr at Melodarr Proxy

Lidarr metadata-server configuration varies by version and deployment method. Use the Melodarr Proxy base URL wherever Lidarr expects the metadata server URL:

```text
http://<proxy-host>:3055
```

If your Lidarr setup supports custom headers, send:

```http
X-Api-Key: mp_your_key_here
```

If it cannot send custom headers, use the query-string fallback for manual tests and scripts:

```text
http://<proxy-host>:3055/api/v1/artist/lookup?term=radiohead&api_key=mp_your_key_here
```

## 5. Test a Small Flow

1. Search for a well-known artist.
2. Add the artist.
3. Confirm albums populate.
4. Refresh metadata once.
5. Check the Melodarr Proxy Stats page for provider calls and cache hits.

## Current Limits

- Artist lookup is the only Lidarr-style endpoint currently implemented.
- Album and track expansion endpoints are not implemented yet.
- Cover art is returned as provider URLs; artwork is not cached through Melodarr Proxy yet.
- Some Lidarr versions may expect fields that the simplified response does not include yet.

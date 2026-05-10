# Metadata Providers

Melodarr Proxy uses provider modules to fetch and merge artist metadata. The default provider list is:

```text
musicbrainz,itunes
```

This keeps cold artist lookup within the intended request budget while still giving a fallback catalog source and artwork URLs.

## Providers

| Provider | Credential | Strength | Notes |
| --- | --- | --- | --- |
| `musicbrainz` | None | Canonical artist and release-group IDs | Uses the configured MusicBrainz user-agent identity. |
| `itunes` | None | Fast catalog fallback and artwork | Uses `ITUNES_COUNTRY`, default `US`. |
| `theaudiodb` | `THEAUDIODB_API_KEY` | Album metadata and artwork | Optional enrichment provider. |
| `lastfm` | `LASTFM_API_KEY` | Popular albums, tags, images | Optional enrichment provider. |
| `discogs` | `DISCOGS_TOKEN` | Release years and discography data | Higher call cost; best used selectively. |
| Custom Providers | Auth Headers / Query Params | Flexible | Add custom external API mapping endpoints via `CUSTOM_PROVIDERS`. |

> **Note:** `CUSTOM_PROVIDERS` (JSON array format) is the current supported environment-variable format for custom providers, and the Melodash UI can also be used to manage them. The `.env.example` file still documents legacy singular `CUSTOM_PROVIDER_*` variables (e.g., `CUSTOM_PROVIDER_NAME`, `CUSTOM_PROVIDER_BASE_URL`) for backward compatibility, but these are deprecated. Migrate to the `CUSTOM_PROVIDERS` JSON array format for new configurations.

## Configuration

Set providers in `.env`:

```env
METADATA_PROVIDERS=musicbrainz,itunes
PROVIDER_PRIORITY=musicbrainz,theaudiodb,itunes,lastfm,discogs
```

Credentials are optional and should not be committed:

```env
THEAUDIODB_API_KEY=
LASTFM_API_KEY=
DISCOGS_TOKEN=
```

## Observability

Artist lookup responses include provider metadata:

```json
{
  "providers": [
    { "name": "musicbrainz", "albumCount": 18 },
    { "name": "itunes", "albumCount": 27 }
  ]
}
```

The response also includes an `X-Providers` header and the Stats page shows provider calls, errors, and average latency.

## Artwork

Artwork currently comes from provider-supplied URLs:

- MusicBrainz release-group IDs are converted to Cover Art Archive front-cover URLs.
- iTunes returns artwork URLs directly.
- TheAudioDB, Last.fm, and Discogs can provide thumbnails when enabled.

Future work should add a lazy cached artwork endpoint so artist lookup does not fetch extra artwork metadata for every album.

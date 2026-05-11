# Artist Lookup Response Contract

This document defines the stable Lidarr-compatible response contract for:

```http
GET /api/v1/artist/lookup?term={artist}
```

Successful, empty, and degraded lookups return HTTP 200 with a top-level JSON array. Each array item is an artist lookup result normalized for Lidarr/SkyHook-compatible clients.

## Response Format

The response `Content-Type` is:

```http
Content-Type: application/json; charset=utf-8
```

The response body is always a top-level JSON array:

```json
[
  {
    "artistName": "Radiohead",
    "id": "8bfac288-ccc5-448d-9573-c33ea2aa5c30",
    "foreignArtistId": "8bfac288-ccc5-448d-9573-c33ea2aa5c30",
    "disambiguation": "",
    "overview": "",
    "status": "continuing",
    "oldIds": [],
    "aliases": [],
    "artistAliases": [],
    "links": [],
    "images": [],
    "albums": [],
    "ratings": { "votes": 0, "value": 0 },
    "rating": { "count": 0, "value": 0 }
  }
]
```

## Required Artist Fields

Every artist object returned in the top-level array includes these required fields:

- `artistName`
- `id`
- `foreignArtistId`
- `disambiguation`
- `overview`
- `status`
- `oldIds`
- `aliases`
- `artistAliases`
- `links`
- `images`
- `albums`
- `ratings`
- `rating`

The `ratings` field uses `{ "votes": number, "value": number }` (MusicBrainz-style), while `rating` uses `{ "count": number, "value": number }` (Skyhook-style). Both normalize to stable zero-valued objects when no upstream rating data is available.

Unknown upstream provider fields are removed before response serialization.

## Supported Proxy Extension Fields

The proxy includes two categories of extension fields.

**Always-present extension fields** (included in every default lookup response when applicable):

- `partial` — present only when `true` (one or more providers failed)
- `warning` — present only when non-null (describes the degraded state)

**Debug-only extension fields** (included only when `?debug=true` is set on the request):

- `providers`
- `schemaVersion`
- `debug`
- `_generatedAt`

Clients that only understand Lidarr/SkyHook fields can ignore these extension fields. The extension fields are stable proxy metadata and are not sourced directly from arbitrary upstream provider payload keys. Debug-only fields are stripped from the default response by the proxy before serialization.

## Provider Header

`X-Providers` reports the providers that contributed to the response:

```http
X-Providers: musicbrainz,spotify
```

When no provider contributes data, `X-Providers` is present as:

```http
X-Providers: unknown
```

Clients should treat `unknown` as "no provider contributed data."

For degraded responses, `X-Providers` lists providers whose usable normalized data was included in the response. When `?debug=true` is set, failed providers can also appear in the `providers` debug extension field with a zero score and zero album count.

## Image Normalization

Artist images are returned in the artist-level `images` array. Album images are returned in each album object's `images` array. Image objects are normalized to a Lidarr/SkyHook-compatible shape and include stable fields only.

Image URLs are absolute URLs when provided by an upstream provider. Relative paths, provider-specific image envelopes, duplicate image entries, and unsupported provider-only fields are removed during normalization. If an image type is known, it is normalized to a stable type value such as `poster`, `banner`, `fanart`, `cover`, or `unknown`.

If no valid images are available for an artist or album, the corresponding `images` field is an empty array.

## Provider Metadata

The `providers` debug extension field (available only when `?debug=true`) is an array of normalized provider metadata objects.

Provider metadata uses this shape:

```json
{
  "name": "musicbrainz",
  "score": 100,
  "albumCount": 2
}
```

Supported provider metadata fields are:

- `name`: stable provider identifier.
- `score`: numeric provider score when available.
- `albumCount`: numeric count of albums contributed by the provider when available.

Provider metadata must not expose raw upstream provider payloads.

## Empty Results

When no artist matches the lookup term and providers completed successfully, the endpoint returns:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
```

```json
[]
```

An empty result is not an error. It means the lookup completed and no normalized artist result was available for the supplied term.

## Partial Provider Failures

When at least one provider returns usable data and one or more providers fail, the endpoint returns HTTP 200 with the usable normalized results. Returned artist objects set:

```json
{
  "partial": true,
  "warning": "One or more providers failed"
}
```

When `?debug=true` is set, the `providers` debug-only extension field lists normalized provider metadata and may include failed provider entries with `score: 0` and `albumCount: 0`. The top-level array remains valid for Lidarr/SkyHook clients, and required artist fields remain present.

## All-Provider Failures

When all configured providers fail, the endpoint still returns HTTP 200 with a top-level JSON array.

If no stale or fallback normalized artist data is available, the response is:

```json
[]
```

If stale or fallback normalized artist data is available, the response may include artist objects with:

```json
{
  "partial": true,
  "warning": "One or more providers failed"
}
```

Clients must not depend on HTTP 5xx responses to detect provider lookup failure for this endpoint. Degraded and all-provider failure states are represented in the JSON contract. When `?debug=true` is set, provider metadata is available in the `providers` debug extension field.

## Backward Compatibility

This contract preserves backward compatibility with Lidarr/SkyHook clients by:

- returning HTTP 200 for successful, empty, and degraded lookup outcomes;
- returning a top-level JSON array for every HTTP 200 lookup response;
- always including the required artist fields expected by Lidarr-compatible clients;
- normalizing missing optional data to stable empty values;
- removing unknown upstream provider fields before response serialization;
- limiting proxy-specific data to the supported extension fields listed in this document.

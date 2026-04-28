# Lidarr Compatibility

Melodarr Proxy is a lightweight compatibility layer, not a full Lidarr metadata server replacement.

## Current Status

| Flow | Status | Notes |
| --- | --- | --- |
| Artist search | Partial | `GET /api/v1/artist/lookup?term=` returns artist, providers, and albums. |
| Add artist | Experimental | Depends on how strict the Lidarr client is about metadata-server fields. |
| Album lookup | Not implemented | Planned as a future endpoint. |
| Track expansion | Not implemented | Intentionally avoided during artist search to keep call count low. |
| Cover art | Partial | Album rows can include `coverUrl`; no lazy cached artwork endpoint yet. |
| Metadata refresh | Not implemented | Needs more Lidarr flow testing. |

## Supported Endpoint

```http
GET /api/v1/artist/lookup?term={artist}
```

Authentication for Lidarr should use an API key:

```http
X-Api-Key: mp_...
```

## Known Gaps

- Response shape is simplified and may not satisfy every Lidarr metadata-server expectation.
- Album and track endpoints are not implemented.
- Cover art is currently URL-based and not proxied/cached through a dedicated artwork endpoint.
- Provider results can vary based on enabled providers and upstream availability.

## Testing Checklist

- [ ] Configure Lidarr to use Melodarr Proxy. See [lidarr-setup.md](lidarr-setup.md).
- [ ] Search for a well-known artist.
- [ ] Add the artist.
- [ ] Confirm albums populate.
- [ ] Confirm refresh does not trigger excessive upstream calls.
- [ ] Confirm cache hits after repeated searches.
- [ ] Capture any fields Lidarr expects but Melodarr Proxy does not return.

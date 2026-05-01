cat > compose.yml <<COMPOSE
services:
  proxy:
    image: ghcr.io/melodarr/melodarr-proxy:latest
    restart: unless-stopped
    environment:
      PORT: 3000
      REDIS_URL: redis://redis:6379
      DATA_DIR: /data
      APP_NAME: melodarr-proxy
      APP_VERSION: latest
      APP_CONTACT: admin@example.com
      METADATA_PROVIDERS: musicbrainz,itunes
      PROVIDER_PRIORITY: musicbrainz,theaudiodb,itunes,lastfm,discogs
      MUSICBRAINZ_BASE_URL: https://musicbrainz.org/ws/2
      MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS: 1100
      CACHE_TTL_SECONDS: 86400
      UPSTREAM_TIMEOUT_MS: 8000
      SLOW_REQUEST_MS: 2000
      NODE_OPTIONS: --dns-result-order=ipv4first
    ports:
      - "3055:3000"
    volumes:
      - melodarr_proxy_data:/data
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--save", "", "--appendonly", "no"]

  devdash:
    image: ghcr.io/melodarr/melodarr-proxy-devdash:latest
    restart: unless-stopped
    environment:
      PORT: 3000
      PROXY_API_URL: http://proxy:3000/api
    ports:
      - "55026:3000"
    depends_on:
      - proxy

volumes:
  melodarr_proxy_data:
COMPOSE

sed -i '' \
  -e 's/devdash/melodash/g' \
  -e 's/DevDash/Melodash/g' \
  -e 's/DEVDASH/MELODASH/g' \
  -e 's/melodarr-proxy-devdash/melodarr-proxy-melodash/g' \
  -e 's#src/devdash#melodash#g' \
  -e 's#\./devdash#\./melodash#g' \
  compose.yml

awk '/PORT: 3000/ && !inserted {
  print $0
  print "      REQUIRE_API_KEY: \"false\""
  inserted = 1
  next
}
{ print }' compose.yml > compose.yml.tmp && mv compose.yml.tmp compose.yml

sed -i '' 's/^[[:space:]]*\\*[[:space:]]*REQUIRE_API_KEY/      REQUIRE_API_KEY/g' compose.yml

docker run --rm -v $(pwd)/compose.yml:/compose.yml mikefarah/yq eval '.' /compose.yml

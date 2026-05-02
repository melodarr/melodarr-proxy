# Reverse Proxy Examples

These examples publish the API and dashboard on separate hostnames:

```text
https://melodarr-proxy.example.com  -> proxy container, port 3055
https://melodash.example.com        -> Melodash container, port 55026
```

Keep them separate. The proxy serves API/docs endpoints. Melodash serves the operator dashboard.

## Required Melodash Environment

When Melodash is behind a public hostname, set the browser-facing proxy URL:

```env
NEXT_PUBLIC_PROXY_BASE_URL=https://melodarr-proxy.example.com
NEXT_PUBLIC_PROXY_FALLBACK=https://melodarr-proxy.example.com
PROXY_API_URL=http://proxy:3000/api
```

In Docker Compose, `PROXY_API_URL` is the server-side internal Docker URL. `NEXT_PUBLIC_PROXY_BASE_URL` is the browser-side public URL.

Example Compose fragment:

```yaml
services:
  proxy:
    image: ghcr.io/melodarr/melodarr-proxy:latest
    ports:
      - "3055:3000"

  melodash:
    image: ghcr.io/melodarr/melodarr-proxy-melodash:latest
    environment:
      PROXY_API_URL: http://proxy:3000/api
      NEXT_PUBLIC_PROXY_BASE_URL: https://melodarr-proxy.example.com
      NEXT_PUBLIC_PROXY_FALLBACK: https://melodarr-proxy.example.com
    ports:
      - "55026:3000"
```

If your reverse proxy runs inside the same Docker network, you can avoid exposing `3055` and `55026` on the host and route directly to `proxy:3000` and `melodash:3000`.

## Caddy

Host-port routing:

```caddyfile
melodarr-proxy.example.com {
  reverse_proxy 127.0.0.1:3055
}

melodash.example.com {
  reverse_proxy 127.0.0.1:55026
}
```

Docker-network routing when Caddy is in the same Compose network:

```caddyfile
melodarr-proxy.example.com {
  reverse_proxy proxy:3000
}

melodash.example.com {
  reverse_proxy melodash:3000
}
```

Useful hardening:

```caddyfile
melodarr-proxy.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3055
}

melodash.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:55026
}
```

## Nginx Proxy Manager

Create two Proxy Hosts.

### Proxy API Host

```text
Domain Names: melodarr-proxy.example.com
Scheme: http
Forward Hostname / IP: <docker-host-ip>
Forward Port: 3055
Cache Assets: off
Block Common Exploits: on
Websockets Support: on
```

SSL tab:

```text
Request a new SSL Certificate
Force SSL: on
HTTP/2 Support: on
HSTS Enabled: optional
```

### Melodash Host

```text
Domain Names: melodash.example.com
Scheme: http
Forward Hostname / IP: <docker-host-ip>
Forward Port: 55026
Cache Assets: off
Block Common Exploits: on
Websockets Support: on
```

SSL tab:

```text
Request a new SSL Certificate
Force SSL: on
HTTP/2 Support: on
HSTS Enabled: optional
```

If Nginx Proxy Manager runs in the same Docker network, use service names instead:

```text
melodarr-proxy.example.com -> http://proxy:3000
melodash.example.com       -> http://melodash:3000
```

## Traefik

Example labels for a Compose deployment where Traefik is attached to the same Docker network.

```yaml
services:
  proxy:
    image: ghcr.io/melodarr/melodarr-proxy:latest
    labels:
      - traefik.enable=true
      - traefik.http.routers.melodarr-proxy.rule=Host(`melodarr-proxy.example.com`)
      - traefik.http.routers.melodarr-proxy.entrypoints=websecure
      - traefik.http.routers.melodarr-proxy.tls=true
      - traefik.http.routers.melodarr-proxy.tls.certresolver=letsencrypt
      - traefik.http.services.melodarr-proxy.loadbalancer.server.port=3000

  melodash:
    image: ghcr.io/melodarr/melodarr-proxy-melodash:latest
    environment:
      PROXY_API_URL: http://proxy:3000/api
      NEXT_PUBLIC_PROXY_BASE_URL: https://melodarr-proxy.example.com
      NEXT_PUBLIC_PROXY_FALLBACK: https://melodarr-proxy.example.com
    labels:
      - traefik.enable=true
      - traefik.http.routers.melodash.rule=Host(`melodash.example.com`)
      - traefik.http.routers.melodash.entrypoints=websecure
      - traefik.http.routers.melodash.tls=true
      - traefik.http.routers.melodash.tls.certresolver=letsencrypt
      - traefik.http.services.melodash.loadbalancer.server.port=3000
```

If you use a named Traefik network:

```yaml
networks:
  proxy:
    external: true

services:
  proxy:
    networks:
      - proxy
    labels:
      - traefik.docker.network=proxy

  melodash:
    networks:
      - proxy
    labels:
      - traefik.docker.network=proxy
```

## Verification

Check the proxy hostname:

```bash
curl -s https://melodarr-proxy.example.com/api/health
curl -s https://melodarr-proxy.example.com/api/ready
curl -s https://melodarr-proxy.example.com/openapi.json
```

Check Melodash:

```bash
curl -I https://melodash.example.com/dashboard
```

Then open:

```text
https://melodash.example.com/dashboard
```

## Common Problems

### Melodash Shows `Proxy unreachable`

Set:

```env
NEXT_PUBLIC_PROXY_BASE_URL=https://melodarr-proxy.example.com
```

Then recreate Melodash:

```bash
docker compose up -d --force-recreate melodash
```

### `Unexpected token '<'`

Melodash is receiving HTML instead of JSON. Usually the browser is calling the Melodash hostname for an API route.

Check browser/devtools or container env and make sure the API base is:

```text
https://melodarr-proxy.example.com
```

not:

```text
https://melodash.example.com
```

### Lidarr Cannot Reach The Proxy

If Lidarr is outside the Compose network, use:

```text
https://melodarr-proxy.example.com
```

If Lidarr is inside the same Compose network, use:

```text
http://proxy:3000
```

### Authentication Fails

Create an API key in Melodash Settings and send it as:

```text
X-Api-Key: mp_...
```

or use the path API-key form for clients that strip query parameters:

```text
https://melodarr-proxy.example.com/api/mp_your_key_here
```

# Melodarr Proxy

> A lightweight, self-hostable Music Metadata Proxy with real-time observability and caching.

## 🚀 Features

* **Real-time MusicBrainz proxy:** Safely queries upstream metadata APIs.
* **Redis-backed caching (with fallback):** Stores lookups locally and gracefully degrades to in-memory caching if Redis fails.
* **Live dashboard:** Monitor system health, lookup stats, and latency metrics directly from the browser.
* **Control endpoints:** Trigger cache clears, start/stop the proxy, and force synchronizations.
* **Configurable User-Agent:** Respects MusicBrainz requirements by exposing properly formatted User-Agent headers (`appName/appVersion (appContact)`).

## ⚡ Quick Start

### Local

```bash
npm install
node src/server.js
```

### Docker

```bash
docker compose up --build
```

If the default port (`3055`) is busy on your host machine, override it with `HOST_PORT`:

```bash
HOST_PORT=3100 docker compose up --build
```

## 🔍 Verify It Works

Run these commands to verify your deployment is healthy and responding.

Check the overall health of the proxy, upstream connection, and caching layer:
```bash
curl http://localhost:3055/api/health
```
*(Expected output: JSON containing `"status": "ok"` and `"proxy": "running"`)*

Check runtime metrics (such as cache hit rates and total proxy duration):
```bash
curl http://localhost:3055/api/stats
```
*(Expected output: JSON containing request counts, cache metrics, and application state)*

Run a live artist search through the proxy:
```bash
curl "http://localhost:3055/api/v1/artist/lookup?term=drake"
```
*(Expected output: JSON payload with `artistName` and a list of `albums` matching the search)*

## ⚙️ Configuration

Copy `.env.example` to `.env` to configure the proxy.

```bash
cp .env.example .env
```

You can customize the following variables in your `.env` file to control the server port, caching layer, and MusicBrainz identification fields:
* `PORT` / `HOST_PORT` - The internal/external port of the proxy.
* `REDIS_URL` - Redis connection string for caching.
* `APP_NAME`, `APP_VERSION`, `APP_CONTACT` - Defines the `User-Agent` to meet the upstream requirements.

## 📊 Observability

This proxy provides a comprehensive suite of observability endpoints to guarantee you always know what is going on.

* **`/api/health`**: Returns a snapshot of system health, identifying degraded states if Redis or the Upstream API goes down.
* **`/api/stats`**: Detailed application counters including queries handled, success/failure ratios, and active cache items.
* **Cache Metrics**: Track exactly how often the proxy intercepts redundant calls via Redis vs. falling back to the Upstream source.
* **Latency Tracking**: Monitors request durations to isolate slow responses from MusicBrainz endpoints.

## 🤝 Contributing

We welcome improvements! See our [CONTRIBUTING.md](./CONTRIBUTING.md) for more details on how to set up your environment, code style, and submission guidelines.

## 📄 License

MIT

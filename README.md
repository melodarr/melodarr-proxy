# 🚀 Melodarr Proxy

> A lightweight, self-hostable **Music Metadata Proxy with built-in observability, caching, and control**.

Melodarr Proxy is not just a proxy—it’s an **operational layer** for MusicBrainz and similar metadata services.

---

## 🔥 Why this exists

Most metadata proxies are:

* opaque
* hard to debug
* or fragile under load

Melodarr Proxy solves that by giving you:

👉 **full visibility**
👉 **runtime control**
👉 **predictable behavior**

---

## ⚡ Key Capabilities

* 📡 **Real-time MusicBrainz proxy**
  Safely queries upstream APIs with proper User-Agent handling

* ⚡ **Redis-backed caching (with fallback)**
  Automatically degrades to in-memory if Redis is unavailable

* 📊 **Built-in observability**
  Health, metrics, latency, and cache performance out of the box

* 🛡 **Rate limiting (abuse protection)**
  Prevents upstream overload (60 req/min per IP)

* 🔁 **Fail-fast startup validation**
  Detects broken configs before serving traffic

* 🎛 **Operational control endpoints**
  Start/stop proxy, clear cache, trigger sync

* 🧠 **Interactive dashboard**
  Live system state, not static UI

---

## 🧪 Verify It Works (Trust Layer)

If these pass, your system is operational:

```bash
curl http://localhost:3055/api/health
curl http://localhost:3055/api/stats
curl "http://localhost:3055/api/v1/artist/lookup?term=radiohead"
```

Expected:

* `/health` → `"status": "ok"`
* `/stats` → real metrics (not empty)
* `/lookup` → artist + albums returned

If any of these fail → investigate before proceeding.

---

## 🐳 Quick Start

### Docker (Recommended)

```bash
docker compose up --build
```

App will be available at:

👉 http://localhost:3055

If port is busy:

```bash
HOST_PORT=3100 docker compose up --build
```

---

### Local

```bash
npm install
node src/server.js
```

---

## ⚙️ Configuration

Copy `.env.example`:

```bash
cp .env.example .env
```

Key variables:

* `PORT` / `HOST_PORT` → server ports
* `REDIS_URL` → caching backend
* `UPSTREAM_URL` → MusicBrainz endpoint
* `APP_NAME`, `APP_VERSION`, `APP_CONTACT` → User-Agent identity

---

## 📊 Observability (First-Class Feature)

Melodarr Proxy is designed to be **inspectable in real time**.

### Core Endpoints

* **`/api/health`**
  Deep system health:

  * Redis status
  * upstream availability
  * memory usage

* **`/api/stats`**
  Live metrics:

  * requests/min
  * cache hits/misses
  * latency (avg + p95)
  * error rate

* **`/api/stats/history`**
  Rolling performance snapshots (last 10 intervals)

* **`/api/version`**
  Release identity + environment verification

---

## 🧠 How It Works

1. Request hits proxy
2. Cache checked (Redis → fallback memory)
3. If miss → upstream queried
4. Response cached + metrics updated
5. Observability endpoints reflect everything in real time

---

## 🛡 Production Behavior

* Rate-limited upstream access
* Structured JSON logging
* Fail-fast boot validation
* Graceful cache fallback
* Health degradation reporting

---

## 🤝 Contributing

We welcome contributions.

See 👉 [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 📄 License

MIT

---

## 🚀 What’s next

Planned improvements:

* adaptive caching (hot query detection)
* multi-upstream support
* DevDash integration
* deeper analytics

---

## 💬 Final Note

This project is built with a **production mindset from day one**.

👉 Not just a proxy
👉 A **controllable, observable metadata layer**

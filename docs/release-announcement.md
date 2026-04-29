# 🚀 Melodarr Proxy v1.0 — Release Announcement

Today I’m releasing **Melodarr Proxy v1.0** — a lightweight, self-hostable Music Metadata Proxy built for reliability, observability, and control.

This started as a simple proxy experiment. It’s now a fully operational, highly-observable replacement for the default Lidarr proxy that you can run, monitor, and trust.

---

## 🔥 What makes this different

Most metadata proxies are either:

* opaque
* hard to debug
* or brittle under load

Melodarr Proxy is designed differently:

* 📊 **Built-in observability** — real-time health + metrics endpoints
* ⚡ **Smart caching layer** — Redis-backed with automatic fallback
* 🛡 **Abuse protection** — rate-limited upstream access
* 🔁 **Fail-fast startup** — detects broken environments before serving traffic
* 🧠 **Operational dashboard** — live system state, not static UI
* 🧩 **Fully self-hostable** — no external dependencies required

---

## 🧪 Verify it yourself

```bash
curl http://localhost:3055/api/health
curl http://localhost:3055/api/stats
curl "http://localhost:3055/api/search?q=radiohead"
```

If it doesn’t pass these checks — something is wrong. That’s intentional.

---

## ⚙️ Key Features

* MusicBrainz proxy with proper User-Agent handling
* Redis cache (with in-memory fallback)
* Sliding window rate limiting (60 req/min/IP)
* Structured JSON logging
* Metrics engine (RPM, latency, error rate, p95)
* Historical stats snapshots (`/api/stats/history`)
* Version endpoint (`/api/version`)
* Interactive settings UI (with product name generation + history)
* Docker-first deployment (port-safe defaults)

---

## 🐳 Quick Start

```bash
docker compose up --build
```

App will be available at:

👉 http://localhost:3055

---

## 🧠 Why this exists

When working with metadata systems (and specifically the default Lidarr proxy), I kept running into the same problems:

* No visibility into what the system is doing
* No control over request behavior
* No way to diagnose issues quickly

So this project solves that:

👉 **It's a robust, observable replacement for the default Lidarr proxy.**
👉 **It turns a black-box proxy into a transparent operational system.**

---

## 📊 Observability-first design

Endpoints available out of the box:

* `/api/health` → deep system health (Redis, upstream, memory)
* `/api/stats` → live metrics
* `/api/stats/history` → rolling performance snapshots
* `/api/version` → release identity

---

## 🛡 Production mindset (from day one)

* Fail-fast boot validation
* Rate limiting to protect upstream APIs
* Structured logging for real debugging
* Docker + CI validated builds

---

## 🤝 Open Source

MIT licensed. Contributions welcome.

If you want to improve:

* performance
* caching strategies
* integrations

PRs are open.

---

## 🚀 What’s next

This is just v1.0.

Next focus areas:

* smarter query pattern detection
* adaptive caching
* deeper Melodash integration
* multi-upstream support

---

## 💬 Feedback

If you try it, break it, or improve it — I want to hear it.

---

👉 This isn’t just a proxy anymore.
👉 It’s a controllable, observable metadata layer.

#opensource #nodejs #docker #observability #selfhosted

# Testing Guide

This document outlines the standard API paths and corresponding curl commands to verify the Melodarr Proxy functionalities.

## 1. Health Checks
Ensures that the proxy, redis, and upstream connections are stable.

```bash
curl -X GET http://localhost:3000/api/health
```
**Expected Output:**
```json
{
  "status": "ok",
  "proxy": "running",
  "upstream": "reachable",
  "cache": "healthy",
  "uptime": 12.34
}
```
*(Note: If Redis fails, `cache` will show `"degraded"` and overall `status` will show `"degraded"`)*

## 2. Stats and Observability
Returns all metrics concerning caching, queries, and errors. Note that this endpoint requires an authenticated session cookie if accessed from the browser, but it's typically accessible if configured for dev/test or utilizing admin credentials.

```bash
curl -X GET http://localhost:3000/api/stats
```
**Expected Output:**
```json
{
  "requests": 15,
  "cacheHits": 12,
  "upstreamCalls": 3,
  "slowRequests": 0,
  "state": {
    "isRunning": true
  }
}
```

## 3. Proxy Search (Upstream Metadata)
Run an active search to fetch upstream metadata and test the Redis cache on subsequent calls.

```bash
curl -X GET "http://localhost:3000/api/v1/artist/lookup?term=drake"
```

## 4. Control Endpoints
Interact with the proxy state directly to simulate maintenance, syncing, or cache clearing.

**Clear Cache:**
```bash
curl -X POST http://localhost:3000/api/cache/clear
```

**Stop Proxy (Returns 503 on subsequent searches):**
```bash
curl -X POST http://localhost:3000/api/proxy/stop
```

**Start Proxy:**
```bash
curl -X POST http://localhost:3000/api/proxy/start
```

**Trigger Sync:**
```bash
curl -X POST http://localhost:3000/api/sync/trigger
```

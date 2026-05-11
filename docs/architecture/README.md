# Architecture

This directory outlines the core system design, data flows, and infrastructure decisions for Melodarr.

## 1. Provider Pipeline
*(Describe how requests flow from entry to the upstream providers)*

## 2. Caching Strategy
*(Document TTLs, invalidation logic, and cache layers)*

## 3. Request Coalescing
*(How in-flight identical requests are merged to prevent thundering herd problems)*

## 4. Fallback Behavior
*(What happens when a primary provider fails)*

## 5. Normalization Flow
*(How external payloads are mutated into the unified Lidarr contract)*

## 6. Contract Enforcement Strategy
*(How the proxy ensures it never returns a malformed response that Lidarr would reject)*

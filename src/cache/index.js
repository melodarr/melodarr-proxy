const Redis = require('ioredis')
const logger = require('../utils/logger')

class CacheLayer {
  constructor () {
    this.redis = null
    this.fallbackMap = new Map()
    this.isRedisHealthy = false
    this.stats = { hits: 0, misses: 0, evictions: 0 }
    this.lastCleanup = null

    this.init()
  }

  init () {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
    try {
      this.redis = new Redis(redisUrl, {
        retryStrategy (times) {
          if (times > 5) {
            return null // Stop retrying after 5 attempts
          }
          return Math.min(times * 50, 2000)
        },
        maxRetriesPerRequest: 1
      })

      this.redis.on('connect', () => {
        logger.info('Redis connected', { context: 'Cache' })
        this.isRedisHealthy = true
      })

      this.redis.on('error', (err) => {
        logger.warn('Redis error, falling back to in-memory', { context: 'Cache', error: err.message })
        this.isRedisHealthy = false
      })

      this.redis.on('end', () => {
        this.isRedisHealthy = false
      })
    } catch (err) {
      logger.warn('Could not init Redis, using in-memory only', { context: 'Cache', error: err.message })
      this.isRedisHealthy = false
    }

    this.fallbackCleanupTimer = setInterval(() => {
      const now = Date.now()
      this.lastCleanup = new Date().toISOString()
      for (const [key, item] of this.fallbackMap.entries()) {
        if (now > item.expiresAt) {
          this.fallbackMap.delete(key)
          this.stats.evictions++
        }
      }
      if (this.fallbackMap.size > 5000) {
        const evictCount = this.fallbackMap.size
        this.fallbackMap.clear()
        this.stats.evictions += evictCount
        logger.warn('Fallback cache map exceeded size limit, cleared map', { context: 'Cache' })
      }
    }, 60000)

    if (this.fallbackCleanupTimer.unref) {
      this.fallbackCleanupTimer.unref()
    }
  }

  async get (key) {
    if (this.isRedisHealthy && this.redis) {
      try {
        const val = await this.redis.get(key)
        if (val) {
          this.stats.hits++
          const parsed = JSON.parse(val)
          if (parsed && parsed.data && parsed.generatedAt) {
            return parsed
          }
          return { data: parsed, generatedAt: new Date().toISOString() }
        }
        this.stats.misses++
        return null
      } catch (err) {
        logger.warn(`Redis get failed for ${key}, trying memory`, { event: 'cache_fallback', context: 'Cache', error: err.message })
      }
    }

    // Fallback
    const item = this.fallbackMap.get(key)
    if (!item) {
      this.stats.misses++
      return null
    }
    if (Date.now() > item.expiresAt) {
      this.fallbackMap.delete(key)
      this.stats.evictions++
      this.stats.misses++
      return null
    }
    this.stats.hits++
    return item.value
  }

  async set (key, value, ttlSeconds = 86400) {
    const payload = {
      data: value,
      generatedAt: new Date().toISOString()
    }
    const tempKey = `temp:${key}:${Date.now()}:${Math.random().toString(36).substring(2, 8)}`

    if (this.isRedisHealthy && this.redis) {
      try {
        await this.redis.set(tempKey, JSON.stringify(payload), 'EX', ttlSeconds)
        await this.redis.rename(tempKey, key)
        return
      } catch (err) {
        logger.warn(`Redis set failed for ${key}, using memory`, { event: 'cache_fallback', context: 'Cache', error: err.message })
        // Clean up temp key if possible but rename failed
        this.redis.del(tempKey).catch(() => {})
      }
    }

    // Fallback
    this.fallbackMap.set(key, {
      value: payload,
      expiresAt: Date.now() + (ttlSeconds * 1000)
    })
  }

  async ttlSeconds (key) {
    if (this.isRedisHealthy && this.redis) {
      try {
        return await this.redis.ttl(key)
      } catch (err) {
        logger.warn(`Redis ttl failed for ${key}, trying memory`, { event: 'cache_fallback', context: 'Cache', error: err.message })
      }
    }

    const item = this.fallbackMap.get(key)
    if (!item || !item.expiresAt) {
      return -2
    }

    return Math.max(0, Math.ceil((item.expiresAt - Date.now()) / 1000))
  }

  async clear () {
    if (this.isRedisHealthy && this.redis) {
      try {
        await this.redis.flushdb()
      } catch (err) {
        logger.warn('Redis clear failed', { context: 'Cache', error: err.message })
      }
    }
    this.fallbackMap.clear()
  }

  async acquireLock (key, ttlMs = 15000) {
    const crypto = require('crypto')
    const token = crypto.randomBytes(16).toString('hex')
    if (this.isRedisHealthy && this.redis) {
      try {
        const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX')
        if (result === 'OK') return token
        return false
      } catch (err) {
        logger.warn(`Redis lock acquire failed for ${key}, falling back to memory`, { event: 'cache_fallback', context: 'Cache', error: err.message })
      }
    }

    // Fallback to in-memory lock
    if (this.fallbackMap.has(key)) {
      const item = this.fallbackMap.get(key)
      if (Date.now() < item.expiresAt) {
        return false
      }
    }
    this.fallbackMap.set(key, { value: token, expiresAt: Date.now() + ttlMs })
    return token
  }

  async releaseLock (key, token) {
    if (!token) return

    if (this.isRedisHealthy && this.redis) {
      try {
        const script = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `
        await this.redis.eval(script, 1, key, token)
        return
      } catch (err) {
        logger.warn(`Redis lock release failed for ${key}`, { context: 'Cache', error: err.message })
      }
    }

    // Fallback
    const item = this.fallbackMap.get(key)
    if (item && item.value === token) {
      this.fallbackMap.delete(key)
    }
  }

  async isReady () {
    return this.isRedisHealthy
  }

  getHealth () {
    return this.isRedisHealthy ? 'healthy' : 'degraded'
  }

  getStats () {
    const total = this.stats.hits + this.stats.misses
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0
    return {
      ...this.stats,
      hitRate: hitRate.toFixed(2) + '%',
      fallbackMapSize: this.fallbackMap.size,
      lastCleanup: this.lastCleanup
    }
  }
}

module.exports = new CacheLayer()

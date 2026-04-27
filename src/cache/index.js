const Redis = require('ioredis');

class CacheLayer {
  constructor() {
    this.redis = null;
    this.fallbackMap = new Map();
    this.isRedisHealthy = false;
    
    this.init();
  }

  init() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      this.redis = new Redis(redisUrl, {
        retryStrategy(times) {
          if (times > 5) {
            return null; // Stop retrying after 5 attempts
          }
          return Math.min(times * 50, 2000);
        },
        maxRetriesPerRequest: 1
      });

      this.redis.on('connect', () => {
        console.log('[Cache] Redis connected');
        this.isRedisHealthy = true;
      });

      this.redis.on('error', (err) => {
        console.warn('[Cache] Redis error, falling back to in-memory:', err.message);
        this.isRedisHealthy = false;
      });
      
      this.redis.on('end', () => {
        this.isRedisHealthy = false;
      });
    } catch (err) {
      console.warn('[Cache] Could not init Redis, using in-memory only', err);
      this.isRedisHealthy = false;
    }
  }

  async get(key) {
    if (this.isRedisHealthy && this.redis) {
      try {
        const val = await this.redis.get(key);
        return val ? JSON.parse(val) : null;
      } catch (err) {
        console.warn(`[Cache] Redis get failed for ${key}, trying memory`, err.message);
      }
    }
    
    // Fallback
    const item = this.fallbackMap.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.fallbackMap.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key, value, ttlSeconds = 86400) {
    if (this.isRedisHealthy && this.redis) {
      try {
        await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
        return;
      } catch (err) {
        console.warn(`[Cache] Redis set failed for ${key}, using memory`, err.message);
      }
    }

    // Fallback
    this.fallbackMap.set(key, {
      value,
      expiresAt: Date.now() + (ttlSeconds * 1000)
    });
  }

  async clear() {
    if (this.isRedisHealthy && this.redis) {
      try {
        await this.redis.flushdb();
      } catch (err) {
        console.warn('[Cache] Redis clear failed', err.message);
      }
    }
    this.fallbackMap.clear();
  }

  getHealth() {
    return this.isRedisHealthy ? 'healthy' : 'degraded';
  }
}

module.exports = new CacheLayer();

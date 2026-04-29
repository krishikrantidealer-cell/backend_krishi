const { redisClient } = require('../config/redis');

/**
 * Cache Utility for high-performance data retrieval
 */
class CacheService {
  /**
   * Get data from cache
   */
  async get(key) {
    try {
      if (!redisClient.isOpen) return null;
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error(`Cache Get Error [${key}]:`, err);
      return null;
    }
  }

  /**
   * Set data to cache with expiration
   * @param {string} key - Cache key
   * @param {any} value - Data to store
   * @param {number} ttl - Time to live in seconds (default 10 mins)
   */
  async set(key, value, ttl = 600) {
    try {
      if (!redisClient.isOpen) return;
      await redisClient.set(key, JSON.stringify(value), {
        EX: ttl
      });
    } catch (err) {
      console.error(`Cache Set Error [${key}]:`, err);
    }
  }

  /**
   * Delete specific cache key
   */
  async del(key) {
    try {
      if (!redisClient.isOpen) return;
      await redisClient.del(key);
    } catch (err) {
      console.error(`Cache Del Error [${key}]:`, err);
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async delByPattern(pattern) {
    try {
      if (!redisClient.isOpen) return;
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    } catch (err) {
      console.error(`Cache DelPattern Error [${pattern}]:`, err);
    }
  }
}

module.exports = new CacheService();

const redis = require('redis');

const redisClient = redis.createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('Redis: Max retries reached. Stopping reconnection.');
        return new Error('Max retries reached');
      }
      return Math.min(retries * 100, 3000); // Backoff strategy
    },
    connectTimeout: 10000,
    keepAlive: 5000,
  }
});

redisClient.on('error', (err) => console.error('Redis Client Error:', err));
redisClient.on('connect', () => console.log('Redis Connected'));
redisClient.on('reconnecting', () => console.log('Redis Reconnecting...'));
redisClient.on('ready', () => console.log('Redis Ready'));

(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error('Initial Redis connection failed:', err);
  }
})();

module.exports = redisClient;

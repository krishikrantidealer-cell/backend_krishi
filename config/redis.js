const { createClient } = require('redis');
const dotenv = require('dotenv');

dotenv.config();

const redisClient = createClient({
  url: process.env.REDIS_URL,
  disableOfflineQueue: true,
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: (retries) => {
      // Limit reconnect rate and back off gracefully
      return Math.min(retries * 1000, 30000);
    }
  }
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

const connectRedis = async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log('✅ Redis connected successfully');
  }
};

module.exports = {
  redisClient,
  connectRedis
};

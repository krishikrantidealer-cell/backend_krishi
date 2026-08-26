const { createClient } = require('redis');
const dotenv = require('dotenv');

dotenv.config();

let redisClient;
let redisSubscriber;

if (process.env.REDIS_URL) {
  redisClient = createClient({
    url: process.env.REDIS_URL,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => {
        if (retries > 5) return new Error('Redis reconnection limit reached');
        return Math.min(retries * 1000, 10000);
      }
    }
  });

  redisClient.on('error', (err) => console.error('[Redis Client Error]:', err.message));

  redisSubscriber = redisClient.duplicate();
  redisSubscriber.on('error', (err) => console.error('[Redis Subscriber Error]:', err.message));
} else {
  // Safe mock client when REDIS_URL is not configured
  redisClient = {
    isOpen: false,
    connect: async () => {},
    get: async () => null,
    set: async () => 'OK',
    del: async () => 1,
    publish: async () => 0,
    sendCommand: async () => 'OK',
    ping: async () => 'PONG',
    on: () => {}
  };

  redisSubscriber = {
    isOpen: false,
    connect: async () => {},
    subscribe: async () => {},
    unsubscribe: async () => {},
    on: () => {}
  };
}

const connectRedis = async () => {
  if (process.env.REDIS_URL) {
    try {
      if (!redisClient.isOpen) await redisClient.connect();
      if (redisSubscriber && !redisSubscriber.isOpen) await redisSubscriber.connect();
      console.log('✅ Redis client and subscriber connected successfully');
    } catch (err) {
      console.warn('⚠️ Redis connection failed, continuing with fallback:', err.message);
    }
  }
};

module.exports = {
  redisClient,
  redisSubscriber,
  connectRedis
};

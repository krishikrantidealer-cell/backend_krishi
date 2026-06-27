require('dotenv').config();
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const cronService = require('./services/cron.service');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    // Run database migrations/self-healing tasks on startup
    try {
      const migrateCoupons = require('./utils/couponMigration');
      await migrateCoupons();
    } catch (migErr) {
      console.error('Migration failed:', migErr.message);
    }

    try {
      await connectRedis();
    } catch (redisErr) {
      console.error('⚠️ Redis connection failed during startup, continuing without Redis:', redisErr.message);
    }

    // Import app
    const app = require('./app');
    const http = require('http');
    const server = http.createServer(app);
    const { initWebSocket } = require('./services/websocket.service');

    initWebSocket(server);

    server.listen(PORT, () => {
      console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
      
      // Start background tasks (Order Tracker, etc.)
      cronService.initCronJobs();
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();


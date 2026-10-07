require('dotenv').config();
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const cronService = require('./services/cron.service');

const PORT = process.env.PORT || 8080;

const startServer = async () => {
  try {
    const app = require('./app');
    const http = require('http');
    const server = http.createServer(app);
    const { initWebSocket } = require('./services/websocket.service');

    initWebSocket(server);

    // Listen on PORT on 0.0.0.0 immediately so Cloud Run health check passes instantly
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running in ${process.env.NODE_ENV || 'production'} mode on http://0.0.0.0:${PORT}`);

      // Run background DB connections, Redis, and migrations asynchronously
      (async () => {
        try {
          await connectDB();
        } catch (dbErr) {
          console.error('⚠️ DB connection failed:', dbErr.message);
        }

        try {
          await connectRedis();
        } catch (redisErr) {
          console.error('⚠️ Redis connection failed:', redisErr.message);
        }

        try {
          const migrateCoupons = require('./utils/couponMigration');
          await migrateCoupons();
        } catch (migErr) {
          console.error('Migration failed (Coupons):', migErr.message);
        }

        try {
          const migrateCustomOrders = require('./utils/customOrdersMigration');
          await migrateCustomOrders();
        } catch (migErr) {
          console.error('Migration failed (customOrders):', migErr.message);
        }

        // Start background tasks (Order Tracker, etc.)
        cronService.initCronJobs();
      })();
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();


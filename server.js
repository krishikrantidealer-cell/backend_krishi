require('dotenv').config();
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const cronService = require('./services/cron.service');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // 1. Connect to Database (Essential)
    await connectDB();

    // 2. Initialize App & Server early to satisfy Cloud Run health checks
    const app = require('./app');
    const http = require('http');
    const server = http.createServer(app);
    const { initWebSocket } = require('./services/websocket.service');

    initWebSocket(server);

    server.listen(PORT, () => {
      console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
      
      // 3. Run background tasks (Migrations & Redis) AFTER server starts listening
      // This ensures Cloud Run health checks pass immediately.

      (async () => {
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


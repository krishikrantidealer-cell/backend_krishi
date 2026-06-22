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

    await connectRedis();

    // Import app ONLY after Redis is connected
    const app = require('./app');

    app.listen(PORT, () => {
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


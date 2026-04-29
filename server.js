require('dotenv').config();
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');

const PORT = process.env.PORT || 5000;

// Connect to Databases and Start Server
const startServer = async () => {
  try {
    await connectDB();
    await connectRedis();

    // Import app ONLY after Redis is connected
    const app = require('./app');

    app.listen(PORT, () => {
      console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();


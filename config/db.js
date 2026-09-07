const mongoose = require('mongoose');

let isConnecting = false;

const connectDB = async () => {
  const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoURI) {
    console.error('Error: MONGODB_URI or MONGO_URI environment variable is missing.');
    return;
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (isConnecting) return;
  isConnecting = true;

  try {
    const conn = await mongoose.connect(mongoURI, {
      maxPoolSize: 20,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      heartbeatFrequencyMS: 10000,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    isConnecting = false;
    return conn;
  } catch (error) {
    isConnecting = false;
    console.error(`MongoDB Connection Error: ${error.message}`);
    // Auto-retry connection after 3 seconds
    setTimeout(connectDB, 3000);
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected! Attempting reconnect...');
  setTimeout(connectDB, 2000);
});

mongoose.connection.on('error', (err) => {
  console.error('⚠️ MongoDB connection runtime error:', err.message);
});

module.exports = connectDB;

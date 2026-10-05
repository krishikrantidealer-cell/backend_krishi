require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function inspectSalesAgents() {
  try {
    const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI;
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    console.log('Connected to MongoDB successfully!');

    // Find all users with role 'sales' or 'admin'
    const agents = await User.find({
      role: { $in: ['sales', 'admin', 'manager', 'telecaller'] },
      isDeleted: { $ne: true }
    }).select('firstName lastName email phoneNumber role myoperatorConfig isAvailableForCalls createdAt').lean();

    console.log(`\nFound ${agents.length} agent/admin users:\n`);
    agents.forEach((agent, i) => {
      console.log(`[${i + 1}] ID: ${agent._id}`);
      console.log(`    Name: ${agent.firstName} ${agent.lastName || ''}`);
      console.log(`    Email: ${agent.email}`);
      console.log(`    Phone: ${agent.phoneNumber}`);
      console.log(`    Role: ${agent.role}`);
      console.log(`    MyOperator Config: ${agent.myoperatorConfig ? JSON.stringify(agent.myoperatorConfig) : 'None'}`);
      console.log('--------------------------------------------------');
    });

    process.exit(0);
  } catch (error) {
    console.error('Error inspecting sales agents:', error);
    process.exit(1);
  }
}

inspectSalesAgents();

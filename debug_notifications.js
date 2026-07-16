const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const Notification = require('./models/Notification');
const User = require('./models/User');

async function debug() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');

    const totalNotifications = await Notification.countDocuments();
    console.log(`Total notifications in DB: ${totalNotifications}`);

    const sampleNotifications = await Notification.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('user', 'firstName lastName phoneNumber role');

    console.log('\nLast 10 notifications:');
    for (const notif of sampleNotifications) {
      console.log(`- [${notif.createdAt.toISOString()}] user: ${notif.user ? notif.user.phoneNumber + ' (' + notif.user.role + ')' : 'NULL'}, title: "${notif.title}", body: "${notif.body}", isRead: ${notif.isRead}`);
    }

    const admins = await User.find({ role: 'admin' });
    console.log(`\nAdmins in DB: ${admins.length}`);
    for (const admin of admins) {
      console.log(`- ${admin.firstName || ''} ${admin.lastName || ''} (${admin.phoneNumber || admin.email}) ID: ${admin._id}`);
    }

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error running debug script:', error);
  }
}

debug();

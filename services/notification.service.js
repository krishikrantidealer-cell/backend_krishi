const admin = require('firebase-admin');
const User = require('../models/User');
const Notification = require('../models/Notification');

// IMPORTANT: The user must place 'serviceAccountKey.json' in the backend root
try {
  const serviceAccount = require('../serviceAccountKey.json');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin initialized successfully.");
  }
} catch (error) {
  console.error("Firebase Admin initialization failed. Please add serviceAccountKey.json to the backend root.", error.message);
}

class NotificationService {
  async sendUtilityNotification(userId, title, body, actionRoute) {
    try {
      // 1. Save to Database (Enterprise Persistent Log)
      const dbNotification = await Notification.create({
        user: userId,
        title: title,
        body: body,
        category: 'utility',
        actionRoute: actionRoute || '/'
      });
      console.log(`Notification logged to database with ID: ${dbNotification._id}`);

      // 2. Send Push Notification via Firebase
      const user = await User.findById(userId);
      if (!user || !user.fcmToken) {
        console.log("FCM Token missing. Push notification skipped, but logged to DB.");
        return;
      }

      const message = {
        token: user.fcmToken,
        notification: {
          title: title,
          body: body
        },
        data: {
          category: 'utility',
          action_route: actionRoute || '/'
        }
      };

      const response = await admin.messaging().send(message);
      console.log(`Utility Notification sent successfully to user ${userId}:`, response);
    } catch (error) {
      console.error('Error sending utility notification:', error);
    }
  }

  async sendMarketingNotification(userId, title, body, actionRoute, imageUrl) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.fcmToken) return;

      const message = {
        token: user.fcmToken,
        notification: {
          title: title,
          body: body,
          ...(imageUrl && { imageUrl: imageUrl })
        },
        data: {
          category: 'marketing',
          action_route: actionRoute || '/cart'
        }
      };

      await admin.messaging().send(message);
      console.log(`Marketing Notification sent successfully to user ${userId}`);
    } catch (error) {
      console.error('Error sending marketing notification:', error);
    }
  }
}

module.exports = new NotificationService();

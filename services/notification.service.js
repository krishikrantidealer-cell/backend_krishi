const admin = require('firebase-admin');
const User = require('../models/User');
const Notification = require('../models/Notification');

try {
  if (!admin.apps.length) {
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
      console.log("Firebase Admin initialized via FIREBASE_SERVICE_ACCOUNT env var.");
    } else {
      try {
        const serviceAccount = require('../serviceAccountKey.json');
        credential = admin.credential.cert(serviceAccount);
        console.log("Firebase Admin initialized via local serviceAccountKey.json.");
      } catch (err) {
        // Fallback to Application Default Credentials on GCP
        credential = admin.credential.applicationDefault();
        console.log("Firebase Admin initialized via Application Default Credentials.");
      }
    }
    admin.initializeApp({ credential });
  }
} catch (error) {
  console.error("Firebase Admin initialization failed:", error.message);
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

      // Check if Firebase is properly initialized
      if (!admin.apps.length) {
        console.warn("Firebase Admin not initialized. Skipping push notification.");
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
      // 1. Save to Database (Enterprise Persistent Log)
      const dbNotification = await Notification.create({
        user: userId,
        title: title,
        body: body,
        category: 'marketing',
        actionRoute: actionRoute || '/cart'
      });
      console.log(`Marketing Notification logged to database with ID: ${dbNotification._id}`);

      // 2. Send Push Notification via Firebase
      const user = await User.findById(userId);
      if (!user || !user.fcmToken) {
        console.log("FCM Token missing. Push notification skipped, but logged to DB.");
        return;
      }

      if (!admin.apps.length) {
        console.warn("Firebase Admin not initialized. Skipping marketing notification.");
        return;
      }

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

      const response = await admin.messaging().send(message);
      console.log(`Marketing Notification sent successfully to user ${userId}:`, response);
    } catch (error) {
      console.error('Error sending marketing notification:', error);
    }
  }

  async notifyAdmins(title, body, actionRoute) {
    try {
      const admins = await User.find({ role: 'admin', isDeleted: { $ne: true } });
      for (const adminUser of admins) {
        await this.sendUtilityNotification(adminUser._id, title, body, actionRoute);
      }
    } catch (error) {
      console.error('Error in notifyAdmins:', error);
    }
  }

  async notifyAdminsAndAgent(agentId, title, body, actionRoute) {
    try {
      let recipients;
      if (agentId) {
        recipients = await User.find({
          $or: [
            { role: 'admin', isDeleted: { $ne: true } },
            { _id: agentId, isDeleted: { $ne: true } }
          ]
        });
      } else {
        recipients = await User.find({ role: 'admin', isDeleted: { $ne: true } });
      }

      for (const recipient of recipients) {
        await this.sendUtilityNotification(recipient._id, title, body, actionRoute);
      }
    } catch (error) {
      console.error('Error in notifyAdminsAndAgent:', error);
    }
  }
}

module.exports = new NotificationService();

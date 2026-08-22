const admin = require('firebase-admin');
const User = require('../models/User');
const Notification = require('../models/Notification');

const path = require('path');
const fs = require('fs');

const { getServiceAccountCredentials } = require('../config/serviceAccountCredentials');

try {
  if (!admin.apps.length) {
    const creds = getServiceAccountCredentials();
    const credential = admin.credential.cert(creds);
    console.log(`Firebase Admin initialized (Project: ${creds.project_id}).`);
    admin.initializeApp({ credential });
  }
} catch (error) {
  console.error("Firebase Admin initialization failed:", error.message);
}

class NotificationService {
  async sendUtilityNotification(userId, title, body, actionRoute, imageUrl) {
    try {
      // 1. Save to Database (Enterprise Persistent Log)
      const dbNotification = await Notification.create({
        user: userId,
        title: title,
        body: body,
        category: 'utility',
        actionRoute: actionRoute || '/',
        ...(imageUrl && { imageUrl: imageUrl })
      });
      console.log(`Notification logged to database with ID: ${dbNotification._id}`);

      // Real-time WebSocket sync
      try {
        const { sendToUser } = require('./websocket.service');
        sendToUser(userId.toString(), { type: 'NOTIFICATION_RECEIVED' });
      } catch (wsErr) {
        console.error('[WS] Failed to send NOTIFICATION_RECEIVED:', wsErr.message);
      }

      // 2. Send Push Notification via Firebase
      const user = await User.findById(userId);
      if (!user || !user.fcmToken) {
        console.log(`FCM Token missing for user ${userId}. Push notification skipped, but logged to DB.`);
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
          body: body,
          ...(imageUrl && { imageUrl: imageUrl })
        },
        data: {
          category: 'utility',
          action_route: actionRoute || '/',
          title: title,
          body: body,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          ...(imageUrl && { image: imageUrl, imageUrl: imageUrl })
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'krishikranti_high_importance_channel',
            priority: 'max',
            defaultSound: true,
            sound: 'default',
            ...(imageUrl && { imageUrl: imageUrl })
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              contentAvailable: true,
              "mutable-content": 1
            }
          },
          ...(imageUrl && {
            fcmOptions: {
              image: imageUrl
            }
          })
        }
      };

      const response = await admin.messaging().send(message);
      console.log(`Utility Notification sent successfully to user ${userId}:`, response);
    } catch (error) {
      console.error(`Error sending utility notification to user ${userId}:`, error.message);
      if (error.code === 'messaging/registration-token-not-registered' ||
          error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/invalid-argument') {
        console.warn(`[FCM] Removing stale/invalid FCM token for user ${userId}`);
        await User.findByIdAndUpdate(userId, { fcmToken: null }).catch(() => {});
      }
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
        actionRoute: actionRoute || '/dashboard'
      });
      console.log(`Marketing Notification logged to database with ID: ${dbNotification._id}`);

      // Real-time WebSocket sync
      try {
        const { sendToUser } = require('./websocket.service');
        sendToUser(userId.toString(), { type: 'NOTIFICATION_RECEIVED' });
      } catch (wsErr) {
        console.error('[WS] Failed to send NOTIFICATION_RECEIVED for marketing:', wsErr.message);
      }

      // 2. Send Push Notification via Firebase
      const user = await User.findById(userId);
      if (!user || !user.fcmToken) {
        console.log(`FCM Token missing for user ${userId}. Push notification skipped, but logged to DB.`);
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
          action_route: actionRoute || '/dashboard',
          title: title,
          body: body,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          ...(imageUrl && { image: imageUrl })
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'krishikranti_high_importance_channel',
            priority: 'max',
            defaultSound: true,
            sound: 'default',
            ...(imageUrl && { imageUrl: imageUrl })
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              contentAvailable: true,
              "mutable-content": 1
            }
          },
          ...(imageUrl && {
            fcmOptions: {
              image: imageUrl
            }
          })
        }
      };

      const response = await admin.messaging().send(message);
      console.log(`Marketing Notification sent successfully to user ${userId}:`, response);
    } catch (error) {
      console.error(`Error sending marketing notification to user ${userId}:`, error.message);
      if (error.code === 'messaging/registration-token-not-registered' ||
          error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/invalid-argument') {
        console.warn(`[FCM] Removing stale/invalid FCM token for user ${userId}`);
        await User.findByIdAndUpdate(userId, { fcmToken: null }).catch(() => {});
      }
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

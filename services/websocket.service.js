const WebSocket = require('ws');
const url = require('url');
const User = require('../models/User');

let wss;
const clients = new Map(); // userId -> Set of WS connections

const initWebSocket = (server) => {
  wss = new WebSocket.Server({ server });

  wss.on('connection', async (ws, req) => {
    const parameters = url.parse(req.url, true).query;
    const userId = parameters.userId;
    const token = parameters.token;

    // ── Security: verify the JWT token matches the claimed userId ─────────────
    if (userId && token) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
        // Reject if the token's user id doesn't match the claimed userId
        if (decoded.id !== userId && decoded._id !== userId) {
          console.warn(`[WS] Token userId mismatch — claimed: ${userId}, actual: ${decoded.id}`);
          ws.close(4001, 'Unauthorized');
          return;
        }
      } catch (err) {
        console.warn(`[WS] Invalid token on connection attempt:`, err.message);
        ws.close(4001, 'Unauthorized');
        return;
      }
    } else if (!userId) {
      // No userId at all — disconnect silently
      ws.close(4002, 'Missing userId');
      return;
    }

    if (userId) {
      ws.userId = userId;

      // Fetch user info for targeted broadcasts and better display
      try {
        const user = await User.findById(userId).select('role firstName lastName shopName phoneNumber');
        if (user) {
          ws.userRole = user.role;
          ws.userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.shopName;
          ws.userPhone = user.phoneNumber;
        }
      } catch (err) {
        console.error(`[WS] Failed to fetch info for user ${userId}:`, err.message);
      }

      if (!clients.has(userId)) {
        clients.set(userId, new Set());
      }
      clients.get(userId).add(ws);
      console.log(`[WS] Client connected for user: ${userId} (${ws.userRole || 'unknown'}). Total: ${clients.get(userId).size}`);

      // Send acknowledgement so the client knows it's fully connected
      ws.send(JSON.stringify({
        type: 'CONNECTION_ACK',
        data: {
          userId,
          timestamp: new Date().toISOString()
        }
      }));
    }

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);

        if (data.type === 'PING') {
          return ws.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
        }

        if (data.type === 'PRESENCE_UPDATE' && ws.userId) {
          const { redisClient } = require('../config/redis');
          if (redisClient && redisClient.isOpen) {
            const presenceKey = `presence:${ws.userId}`;
            const payload = data.data || {};

            const presenceData = {
              lastSeen: new Date().toISOString(),
              currentScreen: payload.currentScreen || 'Active',
              action: payload.lastAction || 'Active',
              device: payload.platform || 'Unknown',
              sessionId: payload.sessionId || 'unknown'
            };

            await redisClient.hSet(presenceKey, presenceData);
            await redisClient.expire(presenceKey, 60);

            // Targeted Broadcast: Only send presence to Admins and Sales agents
            broadcastToRoles(['admin', 'sales'], {
              type: 'PRESENCE_UPDATE',
              data: {
                user: ws.userId,
                userName: ws.userName,
                userPhone: ws.userPhone,
                ...presenceData
              }
            });
          }
        }
      } catch (err) {
        // Ignore non-JSON messages
      }
    });

    ws.on('close', () => {
      if (userId && clients.has(userId)) {
        clients.get(userId).delete(ws);
        if (clients.get(userId).size === 0) {
          clients.delete(userId);
        }
        console.log(`[WS] Client disconnected for user: ${userId}`);
      }
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error for user ${userId}:`, err);
    });
  });

  console.log('[WS] WebSocket Server initialized');
};

const sendToUser = (userId, data) => {
  if (clients.has(userId)) {
    const message = JSON.stringify(data);
    clients.get(userId).forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
    return true;
  }
  return false;
};

const sendToAll = (data) => {
  if (!wss) return;
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

/**
 * Broadcast to specific roles only
 */
const broadcastToRoles = (roles, data) => {
  if (!wss) return;
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && roles.includes(client.userRole)) {
      client.send(message);
    }
  });
};

module.exports = {
  initWebSocket,
  sendToUser,
  sendToAll,
  broadcastToRoles
};

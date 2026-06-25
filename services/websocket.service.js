const WebSocket = require('ws');
const url = require('url');

let wss;
const clients = new Map(); // userId -> Set of WS connections

const initWebSocket = (server) => {
  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    const parameters = url.parse(req.url, true).query;
    const userId = parameters.userId;

    if (userId) {
      ws.userId = userId;
      if (!clients.has(userId)) {
        clients.set(userId, new Set());
      }
      clients.get(userId).add(ws);
      console.log(`[WS] Client connected for user: ${userId}. Total connections: ${clients.get(userId).size}`);
    }

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

module.exports = {
  initWebSocket,
  sendToUser,
  sendToAll
};

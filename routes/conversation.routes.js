const express = require('express');
const router = express.Router();
const controller = require('../controllers/conversation.controller');
const { protect, authorizeRoles, authorizeMyOperatorAgent } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

// Conversational Endpoints (Protected & Authorized for MyOperator Sales Agents / Admin)
router.get('/conversations', protect, authorizeMyOperatorAgent, controller.getConversations);
router.post('/conversations/sync-roster', protect, authorizeMyOperatorAgent, controller.syncRoster);
router.get('/conversations/:id/messages', protect, authorizeMyOperatorAgent, controller.getMessages);
router.post('/conversations/start', protect, authorizeMyOperatorAgent, controller.startConversation);
router.post('/messages/send', protect, authorizeMyOperatorAgent, controller.sendConversationMessage);
router.post('/messages/send-template', protect, authorizeMyOperatorAgent, controller.sendConversationMessage);
router.get('/conversations/media-proxy', controller.proxyMedia);
router.post('/conversations/media/upload-url', protect, authorizeMyOperatorAgent, controller.getMediaUploadUrl);
router.post('/conversations/media/upload', protect, authorizeMyOperatorAgent, upload.single('file'), controller.uploadMedia);
router.post('/conversations/assign', protect, authorizeRoles('admin'), controller.assignConversation);
router.post('/notes', protect, authorizeMyOperatorAgent, controller.addNote);
router.put('/conversations/:id/status', protect, authorizeMyOperatorAgent, controller.updateConversationStatus);
router.put('/conversations/:id/language', protect, authorizeMyOperatorAgent, controller.updateConversationLanguage);
router.put('/conversations/:id/read', protect, authorizeMyOperatorAgent, controller.markAsRead);
router.put('/conversations/:id/unread', protect, authorizeMyOperatorAgent, controller.markAsUnread);

// WhatsApp Templates (Protected)
router.get('/templates', protect, controller.getTemplates);
router.post('/templates', protect, authorizeRoles('admin'), controller.createTemplate);
router.delete('/templates/:id', protect, authorizeRoles('admin'), controller.deleteTemplate);

// Canned Responses / Quick Replies (Protected)
router.get('/canned-responses', protect, controller.getCannedResponses);
router.post('/canned-responses', protect, authorizeRoles('admin', 'sales'), controller.createCannedResponse);
router.put('/canned-responses/:id', protect, authorizeRoles('admin', 'sales'), controller.updateCannedResponse);
router.delete('/canned-responses/:id', protect, authorizeRoles('admin', 'sales'), controller.deleteCannedResponse);

module.exports = router;

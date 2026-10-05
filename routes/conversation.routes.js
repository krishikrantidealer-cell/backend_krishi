const express = require('express');
const router = express.Router();
const controller = require('../controllers/conversation.controller');
const { protect, authorizeRoles } = require('../middlewares/auth.middleware');

// Conversational Endpoints (Protected)
router.get('/conversations', protect, controller.getConversations);
router.get('/conversations/:id/messages', protect, controller.getMessages);
router.post('/conversations/start', protect, controller.startConversation);
router.post('/messages/send', protect, controller.sendConversationMessage);
router.post('/conversations/assign', protect, authorizeRoles('admin'), controller.assignConversation);
router.post('/notes', protect, controller.addNote);
router.put('/conversations/:id/status', protect, controller.updateConversationStatus);
router.put('/conversations/:id/language', protect, controller.updateConversationLanguage);

// WhatsApp Templates (Protected)
router.get('/templates', protect, controller.getTemplates);
router.post('/templates', protect, authorizeRoles('admin'), controller.createTemplate);
router.delete('/templates/:id', protect, authorizeRoles('admin'), controller.deleteTemplate);

// Canned Responses / Quick Replies (Protected)
router.get('/canned-responses', protect, controller.getCannedResponses);
router.post('/canned-responses', protect, authorizeRoles('admin', 'sales'), controller.createCannedResponse);
router.put('/canned-responses/:id', protect, authorizeRoles('admin', 'sales'), controller.updateCannedResponse);
router.delete('/canned-responses/:id', protect, authorizeRoles('admin'), controller.deleteCannedResponse);

module.exports = router;

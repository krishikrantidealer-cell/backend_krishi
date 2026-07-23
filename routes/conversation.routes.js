const express = require('express');
const router = express.Router();
const controller = require('../controllers/conversation.controller');
const { protect, authorizeRoles } = require('../middlewares/auth.middleware');

router.use(protect); // Secure all conversational endpoints

router.get('/conversations', controller.getConversations);
router.get('/conversations/:id/messages', controller.getMessages);
router.post('/conversations/start', controller.startConversation);
router.post('/messages/send', controller.sendConversationMessage);
router.post('/conversations/assign', authorizeRoles('admin'), controller.assignConversation);
router.post('/notes', controller.addNote);
router.put('/conversations/:id/status', controller.updateConversationStatus);
router.put('/conversations/:id/language', controller.updateConversationLanguage);

module.exports = router;

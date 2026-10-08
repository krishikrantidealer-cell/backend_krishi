const express = require('express');
const router = express.Router();
const whatsappTemplateController = require('../controllers/whatsappTemplate.controller');
const { protect } = require('../middlewares/auth.middleware');

// All WhatsApp template endpoints require active authentication
router.use(protect);

router.get('/', whatsappTemplateController.getTemplates);
router.get('/:id', whatsappTemplateController.getTemplateById);
router.post('/', whatsappTemplateController.createTemplate);
router.patch('/:id', whatsappTemplateController.updateTemplate);
router.put('/:id', whatsappTemplateController.updateTemplate);
router.delete('/:id', whatsappTemplateController.deleteTemplate);
router.post('/send', whatsappTemplateController.sendTemplate);

module.exports = router;

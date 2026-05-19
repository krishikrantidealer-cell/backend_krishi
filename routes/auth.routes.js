const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/auth.controller');
const { protect } = require('../middlewares/auth.middleware');
const { authLimiter } = require('../middlewares/rateLimiter');
const validate = require('../middlewares/validate');

const router = express.Router();

// Public routes with rate limiting
router.post(
  '/admin/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Please provide a valid email address'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  validate,
  authController.adminLogin
);

router.post(
  '/send-otp',
  authLimiter,
  [
    body('phoneNumber').isMobilePhone().withMessage('Please provide a valid phone number')
  ],
  validate,
  authController.sendOTP
);

router.post(
  '/verify-otp',
  authLimiter,
  [
    body('phoneNumber').isMobilePhone().withMessage('Please provide a valid phone number'),
    body('otp').isLength({ min: 6, max: 6 }).isNumeric().withMessage('OTP must be 6 digits'),
    body('deviceId').notEmpty().withMessage('Device ID is required')
  ],
  validate,
  authController.verifyOTP
);

router.post(
  '/refresh',
  [
    body('refreshToken').notEmpty().withMessage('Refresh token is required')
  ],
  validate,
  authController.refreshToken
);

// Protected routes
router.post('/logout', protect, authController.logout);
router.post('/logout-all', protect, authController.logoutAll);
router.get('/sessions', protect, authController.getSessions);

module.exports = router;

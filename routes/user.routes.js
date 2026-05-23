const express = require('express');
const { body } = require('express-validator');
const userController = require('../controllers/user.controller');
const { protect } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate');

const upload = require('../middlewares/upload.middleware');

const router = express.Router();

// All user routes are protected
router.use(protect);

// Save FCM Token for notifications
router.post('/fcm-token', userController.updateFcmToken);

// Fetch persistent notification history
router.get('/notifications', userController.getMyNotifications);

router.get('/profile', userController.getProfile);

// Edit Profile API
router.patch(
  '/profile',
  [
    body('firstName').optional().trim().notEmpty().withMessage('First name cannot be empty'),
    body('lastName').optional().trim().notEmpty().withMessage('Last name cannot be empty'),
    body('profileImage').optional().trim().notEmpty().withMessage('Profile image URL cannot be empty'),
    body('addressType').optional().isIn(['Shop', 'Home', 'Godown', 'Other']).withMessage('Invalid address type'),
    body('address.villageArea').optional().trim().notEmpty().withMessage('Village/Area cannot be empty'),
    body('address.cityTehsil').optional().trim().notEmpty().withMessage('City/Tehsil cannot be empty'),
    body('address.pincode').optional().isLength({ min: 6, max: 6 }).withMessage('Pincode must be 6 digits'),
    body('shopName').optional().trim().notEmpty().withMessage('Shop name cannot be empty'),
    body('gstNumber').optional().trim().notEmpty().withMessage('GST number cannot be empty')
  ],
  validate,
  userController.updateProfile
);

// Create your account API (Complete profile)
router.post(
  '/complete-profile',
  [
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('lastName').trim().notEmpty().withMessage('Last name is required'),
    body('addressType').isIn(['Shop', 'Home', 'Godown', 'Other']).withMessage('Invalid address type'),
    body('address.villageArea').trim().notEmpty().withMessage('Village/Area is required'),
    body('address.cityTehsil').trim().notEmpty().withMessage('City/Tehsil is required'),
    body('address.pincode').isLength({ min: 6, max: 6 }).withMessage('Pincode must be 6 digits')
  ],
  validate,
  userController.completeProfile
);

// Submit KYC API
router.post(
  '/kyc',
  upload.single('licenceImage'),
  [
    body('userType').isIn(['Retailer and Distributor']).withMessage('Invalid user type'),
    body('shopName').trim().notEmpty().withMessage('Shop name is required'),
    body('gstNumber').trim().notEmpty().withMessage('GST number is required')
  ],
  validate,
  userController.submitKyc
);

// Shipping Address Management
router.post(
  '/addresses',
  [
    body('name').trim().notEmpty().withMessage('Address name is required'),
    body('villageArea').trim().notEmpty().withMessage('Village/Area is required'),
    body('cityTehsil').trim().notEmpty().withMessage('City/Tehsil is required'),
    body('pincode').isLength({ min: 6, max: 6 }).withMessage('Pincode must be 6 digits'),
    body('phoneNumber').trim().notEmpty().withMessage('Phone number is required')
  ],
  validate,
  userController.addShippingAddress
);

router.delete('/addresses/:addressId', userController.deleteShippingAddress);
router.patch('/addresses/:addressId/default', userController.setDefaultAddress);

// --- ADMIN ROUTES ---
const { authorizeRoles } = require('../middlewares/auth.middleware');

// Get all users (Admin only)
router.get('/', authorizeRoles('admin'), userController.getAllUsers);

// Update KYC Status (Approve/Reject) (Admin only)
router.put('/:userId/kyc', authorizeRoles('admin'), userController.adminUpdateKycStatus);

module.exports = router;

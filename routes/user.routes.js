const express = require('express');
const { body } = require('express-validator');
const userController = require('../controllers/user.controller');
const { protect, authorizeRoles } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate');

const upload = require('../middlewares/upload.middleware');

const router = express.Router();


// All user routes are protected
router.use(protect);

// Save FCM Token for notifications
router.post('/fcm-token', userController.updateFcmToken);

// Fetch persistent notification history
router.get('/notifications', userController.getMyNotifications);
router.put('/notifications/read', userController.markNotificationsAsRead);
// Admin: Send a notification to a specific user (used for admin notes)
router.post('/notifications/send', authorizeRoles('admin', 'sales'), userController.createNotification);


router.get('/profile', userController.getProfile);
router.delete('/me', userController.deleteSelfAccount);

// Edit Profile API
router.patch(
  '/profile',
  [
    body('firstName').optional().trim().notEmpty().withMessage('First name cannot be empty'),
    body('lastName').optional().trim().notEmpty().withMessage('Last name cannot be empty'),
    body('profileImage').optional().trim().notEmpty().withMessage('Profile image URL cannot be empty'),
    body('addressType').optional().isIn(['Shop', 'Home', 'Godown', 'Other']).withMessage('Invalid address type'),
    body('address.villageArea').optional().trim().notEmpty().withMessage('Village/Area cannot be empty'),
    body('address.addressLine2').optional().trim(),
    body('address.address2').optional().trim(),
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
    body('address.addressLine2').optional().trim(),
    body('address.address2').optional().trim(),
    body('address.cityTehsil').trim().notEmpty().withMessage('City/Tehsil is required'),
    body('address.pincode').isLength({ min: 6, max: 6 }).withMessage('Pincode must be 6 digits')
  ],
  validate,
  userController.completeProfile
);

// Submit KYC API
router.post(
  '/kyc',
  upload.fields([
    { name: 'licenceImage', maxCount: 1 },
    { name: 'shopImage', maxCount: 1 }
  ]),
  [
    body('userType').isIn(['retailer']).withMessage('Invalid user type'),
    body('shopName')
      .trim()
      .notEmpty()
      .withMessage('Shop name is required'),
    body('gstNumber').optional({ checkFalsy: true }).trim()
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
    body('addressLine2').optional().trim(),
    body('address2').optional().trim(),
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

// Get all users (Admin and Sales)
router.get('/', authorizeRoles('admin', 'sales'), userController.getAllUsers);

// Update KYC Status (Approve/Reject) (Admin and Sales)
router.put('/:userId/kyc', authorizeRoles('admin', 'sales'), userController.adminUpdateKycStatus);

// Submit KYC for user (Admin and Sales)
router.post(
  '/:userId/kyc',
  authorizeRoles('admin', 'sales'),
  upload.fields([
    { name: 'licenceImage', maxCount: 1 },
    { name: 'shopImage', maxCount: 1 }
  ]),
  userController.adminSubmitKyc
);

// Update User (Admin and Sales)
router.put('/:userId', authorizeRoles('admin', 'sales'), userController.adminUpdateUser);

// Delete User (Admin and Sales)
router.delete('/:userId', authorizeRoles('admin', 'sales'), userController.adminDeleteUser);

// Restore User (Admin and Sales)
router.put('/:userId/restore', authorizeRoles('admin', 'sales'), userController.adminRestoreUser);

// Permanently Delete User (Admin and Sales)
router.delete('/:userId/permanent', authorizeRoles('admin', 'sales'), userController.adminPermanentlyDeleteUser);

// Assign Sales Agent (Admin only)
router.put('/:userId/assign-agent', authorizeRoles('admin'), userController.adminAssignAgent);

// Toggle Block User (Admin only)
router.put('/:userId/block', authorizeRoles('admin'), userController.adminToggleBlockUser);

// Create Sales Agent (Admin only)
router.post('/sales', authorizeRoles('admin'), userController.adminCreateSalesAgent);

// Update Sales Agent (Admin only)
router.put('/sales/:agentId', authorizeRoles('admin'), userController.adminUpdateSalesAgent);

// Delete Sales Agent (Admin only)
router.delete('/sales/:agentId', authorizeRoles('admin'), userController.adminDeleteSalesAgent);

module.exports = router;

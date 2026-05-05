const express = require('express');
const favouriteController = require('../controllers/favourite.controller');
const { protect } = require('../middlewares/auth.middleware');
const { body, param } = require('express-validator');
const validate = require('../middlewares/validate');

const router = express.Router();

// All favourite routes require the user to be logged in
router.use(protect);

// Get user's favourites
router.get('/', favouriteController.getFavourites);

// Add product to favourites
router.post(
  '/',
  [
    body('productId').trim().isMongoId().withMessage('Valid product ID is required')
  ],
  validate,
  favouriteController.addFavourite
);

// Remove product from favourites
router.delete(
  '/:productId',
  [
    param('productId').trim().isMongoId().withMessage('Valid product ID is required')
  ],
  validate,
  favouriteController.removeFavourite
);

// Clear all favourites
router.delete('/', favouriteController.clearFavourites);

module.exports = router;

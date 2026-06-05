const cartService = require('../services/cart.service');

exports.getCart = async (req, res, next) => {
  try {
    const cart = await cartService.getCart(req.user._id);
    res.json({ success: true, cart });
  } catch (error) {
    next(error);
  }
};

exports.addItem = async (req, res, next) => {
  try {
    const { productId, variantId, quantity, variants } = req.body;
    
    // Support both single variant (legacy) and multiple variants
    let variantsList = [];
    if (variants && Array.isArray(variants)) {
      variantsList = variants;
    } else if (variantId) {
      variantsList = [{ variantId, quantity: quantity || 1 }];
    }

    if (variantsList.length === 0) {
      return res.status(400).json({ success: false, message: 'No variants provided' });
    }

    const cart = await cartService.addItemsToCart(req.user._id, productId, variantsList);
    res.status(200).json({ success: true, message: 'Items added to cart', cart });
  } catch (error) {
    next(error);
  }
};

exports.syncCart = async (req, res, next) => {
  try {
    const { items } = req.body;
    const cart = await cartService.syncCart(req.user._id, items);
    res.json({ success: true, message: 'Cart synced', cart });
  } catch (error) {
    next(error);
  }
};

exports.updateQuantity = async (req, res, next) => {
  try {
    const { quantity } = req.body;
    const { itemId } = req.params;
    const cart = await cartService.updateItemQuantity(req.user._id, itemId, quantity);
    res.json({ success: true, message: 'Cart updated', cart });
  } catch (error) {
    next(error);
  }
};

exports.removeItem = async (req, res, next) => {
  try {
    const { itemId } = req.params;
    const cart = await cartService.removeItemFromCart(req.user._id, itemId);
    res.json({ success: true, message: 'Item removed', cart });
  } catch (error) {
    next(error);
  }
};

exports.clearCart = async (req, res, next) => {
  try {
    const cart = await cartService.clearCart(req.user._id);
    res.json({ success: true, message: 'Cart cleared', cart });
  } catch (error) {
    next(error);
  }
};

exports.applyCoupon = async (req, res, next) => {
  try {
    const { code } = req.body;
    const cart = await cartService.applyCouponToCart(req.user._id, code);
    res.json({ success: true, message: 'Coupon applied to cart', cart });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.removeCoupon = async (req, res, next) => {
  try {
    const cart = await cartService.removeCouponFromCart(req.user._id);
    res.json({ success: true, message: 'Coupon removed from cart', cart });
  } catch (error) {
    next(error);
  }
};

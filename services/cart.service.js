const Cart = require('../models/Cart');
const Product = require('../models/Product');
const couponService = require('./coupon.service');

// Concurrency Mutex: guarantees sequential cart updates per user on the server
const locks = new Map();

async function runLocked(userId, fn) {
  const key = userId.toString();
  const currentPromise = locks.get(key) || Promise.resolve();

  const deferred = {};
  const resultPromise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });

  const runTask = async () => {
    try {
      const res = await fn();
      deferred.resolve(res);
    } catch (e) {
      deferred.reject(e);
    }
  };

  const nextPromise = currentPromise.then(runTask).catch(runTask);
  locks.set(key, nextPromise);
  return resultPromise;
}

class CartService {
  async getCart(userId) {
    let cart = await Cart.findOne({ user: userId }).populate('items.product', 'title brandName technicalName vendor images variants');
    if (!cart) {
      cart = await Cart.create({ user: userId, items: [], totalAmount: 0 });
      return cart;
    }

    // Always recalculate dynamic tier prices on fetch to ensure accuracy
    this.calculateTotal(cart);
    await this.recalculateCoupon(cart, userId);
    await cart.save();

    return cart;
  }

  async addItemsToCart(userId, productId, variantsList) {
    return runLocked(userId, async () => {
      const product = await Product.findById(productId);
      if (!product) throw new Error('Product not found');

      let cart = await Cart.findOne({ user: userId }).populate('items.product', 'title brandName technicalName vendor images variants');
      if (!cart) {
        cart = new Cart({ user: userId, items: [], totalAmount: 0 });
      }

      for (const v of variantsList) {
        const variant = product.variants.id(v.variantId);
        if (!variant) continue; // Skip if invalid variant ID

        // Check if item already exists in cart with same variant
        const existingItemIndex = cart.items.findIndex(
          item => item.product._id.toString() === productId && item.variantId.toString() === v.variantId
        );

        if (existingItemIndex > -1) {
          if (v.isReplace) {
            cart.items[existingItemIndex].quantity = (v.quantity || 1);
          } else {
            cart.items[existingItemIndex].quantity += (v.quantity || 1);
          }
        } else {
          cart.items.push({
            product: productId,
            variantId: v.variantId,
            quantity: v.quantity || 1,
            price: variant.price
          });
        }
      }

      // Repopulate newly added products so calculateTotal can read variants
      await cart.populate('items.product', 'title brandName technicalName vendor images variants');

      this.calculateTotal(cart);
      await this.recalculateCoupon(cart, userId);
      await cart.save();
      return cart;
    });
  }

  async updateItemQuantity(userId, itemId, quantity) {
    return runLocked(userId, async () => {
      const cart = await Cart.findOne({ user: userId }).populate('items.product', 'title brandName technicalName vendor images variants');
      if (!cart) throw new Error('Cart not found');

      const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId);
      if (itemIndex === -1) throw new Error('Item not found in cart');

      if (quantity <= 0) {
        cart.items.splice(itemIndex, 1);
      } else {
        cart.items[itemIndex].quantity = quantity;
      }
      this.calculateTotal(cart);
      await this.recalculateCoupon(cart, userId);
      await cart.save();
      return cart;
    });
  }

  async removeItemFromCart(userId, itemId) {
    return runLocked(userId, async () => {
      const cart = await Cart.findOne({ user: userId }).populate('items.product', 'title brandName technicalName vendor images variants');
      if (!cart) throw new Error('Cart not found');

      const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId);
      if (itemIndex > -1) {
        cart.items.splice(itemIndex, 1);
      }

      this.calculateTotal(cart);
      await this.recalculateCoupon(cart, userId);
      await cart.save();
      return cart;
    });
  }

  async clearCart(userId) {
    return runLocked(userId, async () => {
      const cart = await Cart.findOne({ user: userId });
      if (cart) {
        cart.items = [];
        cart.totalAmount = 0;
        cart.appliedCoupon = undefined;
        cart.discountAmount = 0;
        cart.finalAmount = 0;
        cart.freeItems = [];
        await cart.save();
      }
      return cart;
    });
  }

  calculateTotal(cart) {
    let total = 0;
    for (const item of cart.items) {
      if (item.product && item.product.variants) {
        const variant = item.product.variants.id(item.variantId);
        if (variant) {
          const packVolume = variant.packVolume || 1.0;
          const totalVolume = packVolume * item.quantity;
          let correctPrice = variant.price;
          
          if (totalVolume >= 50.0) {
            correctPrice = variant.price50_plus || variant.price;
          } else if (totalVolume >= 30.0) {
            correctPrice = variant.price30_50 || variant.price;
          } else if (totalVolume >= 10.0) {
            correctPrice = variant.price10_30 || variant.price;
          }
          
          item.price = correctPrice * packVolume;
        }
      }
      total += item.price * item.quantity;
    }
    cart.totalAmount = total;
  }

  async recalculateCoupon(cart, userId) {
    if (!cart.appliedCoupon) {
      cart.discountAmount = 0;
      cart.finalAmount = cart.totalAmount;
      cart.freeItems = [];
      return;
    }

    try {
      // Re-validate coupon against the NEW cart total
      const result = await couponService.applyCoupon(userId, cart.appliedCoupon, cart.totalAmount, cart);
      cart.discountAmount = result.discountAmount;
      cart.finalAmount = result.finalAmount;
      cart.freeItems = result.freeProductAdded ? [{
        name: result.freeProductAdded,
        imageUrl: result.freeProductImage || null,
        technicalName: result.freeProductTechnicalName || null,
        variant: result.freeProductVariant || null,
        quantity: result.freeProductQuantity || 1,
        isFree: true
      }] : [];
    } catch (error) {
      // If the cart no longer meets the coupon requirements (e.g. minimum purchase), remove it
      cart.appliedCoupon = undefined;
      cart.discountAmount = 0;
      cart.finalAmount = cart.totalAmount;
      cart.freeItems = [];
    }
  }

  async applyCouponToCart(userId, code) {
    return runLocked(userId, async () => {
      const cart = await Cart.findOne({ user: userId });
      if (!cart || cart.items.length === 0) throw new Error('Cart is empty');

      // Test if coupon is valid before saving
      await couponService.applyCoupon(userId, code, cart.totalAmount, cart);

      cart.appliedCoupon = code.toUpperCase();
      await this.recalculateCoupon(cart, userId);
      await cart.save();
      await cart.populate('items.product', 'title brandName technicalName vendor images variants');
      return cart;
    });
  }

  async removeCouponFromCart(userId) {
    return runLocked(userId, async () => {
      const cart = await Cart.findOne({ user: userId });
      if (!cart) throw new Error('Cart not found');

      cart.appliedCoupon = undefined;
      cart.discountAmount = 0;
      cart.finalAmount = cart.totalAmount;
      cart.freeItems = [];
      await cart.save();
      await cart.populate('items.product', 'title brandName technicalName vendor images variants');
      return cart;
    });
  }
}

module.exports = new CartService();

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

function getCorrectPrice(variant, totalVolume) {
  if (variant.priceTiers && variant.priceTiers.length > 0 && variant.rates) {
    const tiersWithMin = [];
    for (const tier of variant.priceTiers) {
      const name = tier.name || '';
      let minVal = 0;
      const rangeMatch = name.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
      const plusMatch = name.match(/(\d+(?:\.\d+)?)\s*\+/);
      if (rangeMatch) {
        minVal = parseFloat(rangeMatch[1]);
      } else if (plusMatch) {
        minVal = parseFloat(plusMatch[1]);
      } else {
        const numMatch = name.match(/(\d+(?:\.\d+)?)/);
        if (numMatch) {
          minVal = parseFloat(numMatch[1]);
        }
      }
      
      tiersWithMin.push({
        id: tier.id,
        min: minVal,
        name: name
      });
    }

    // Sort by min descending
    tiersWithMin.sort((a, b) => b.min - a.min);

    for (const tier of tiersWithMin) {
      if (totalVolume >= tier.min) {
        const rateVal = variant.rates.get ? variant.rates.get(tier.id) : variant.rates[tier.id];
        if (rateVal) {
          const numMatch = rateVal.match(/^([0-9.]+)/);
          if (numMatch) {
            return parseFloat(numMatch[1]);
          }
        }
      }
    }
  }

  return variant.price;
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

    if (cart.isModified()) {
      await cart.save();
    }

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
        const existingItemIndex = cart.items.findIndex(item => {
          const itemProdId = item.product && item.product._id ? item.product._id.toString() : (item.product ? item.product.toString() : '');
          return itemProdId === productId && item.variantId.toString() === v.variantId;
        });

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
      // Only recalculate tier price if product is fully populated (has variants)
      if (item.product && item.product.variants) {
        const variant = item.product.variants.id(item.variantId);
        if (variant) {
          const packVolume = variant.packVolume || 1.0;
          const totalVolume = packVolume * item.quantity;
          const correctPrice = getCorrectPrice(variant, totalVolume);
          const computedPrice = correctPrice * packVolume;
          if (item.price !== computedPrice) {
            item.price = computedPrice;
          }
        }
      }
      // If product is not populated (ObjectId only), use the stored item.price as-is
      total += item.price * item.quantity;
    }
    if (cart.totalAmount !== total) {
      cart.totalAmount = total;
    }
  }

  async recalculateCoupon(cart, userId) {
    if (!cart.appliedCoupon) {
      if (cart.discountAmount !== 0) cart.discountAmount = 0;
      if (cart.finalAmount !== cart.totalAmount) cart.finalAmount = cart.totalAmount;
      if (cart.freeItems && cart.freeItems.length > 0) cart.freeItems = [];
      return;
    }

    try {
      // Re-validate coupon against the NEW cart total
      const result = await couponService.applyCoupon(userId, cart.appliedCoupon, cart.totalAmount, cart);
      if (cart.discountAmount !== result.discountAmount) cart.discountAmount = result.discountAmount;
      if (cart.finalAmount !== result.finalAmount) cart.finalAmount = result.finalAmount;
      
      const newFreeItems = result.freeProductAdded ? [{
        name: result.freeProductAdded,
        imageUrl: result.freeProductImage || null,
        technicalName: result.freeProductTechnicalName || null,
        variant: result.freeProductVariant || null,
        quantity: result.freeProductQuantity || 1,
        isFree: true
      }] : [];

      // Check if free items changed
      const freeItemsChanged = JSON.stringify(cart.freeItems) !== JSON.stringify(newFreeItems);
      if (freeItemsChanged) {
        cart.freeItems = newFreeItems;
      }
    } catch (error) {
      // If the cart no longer meets the coupon requirements (e.g. minimum purchase), remove it
      if (cart.appliedCoupon !== undefined) cart.appliedCoupon = undefined;
      if (cart.discountAmount !== 0) cart.discountAmount = 0;
      if (cart.finalAmount !== cart.totalAmount) cart.finalAmount = cart.totalAmount;
      if (cart.freeItems && cart.freeItems.length > 0) cart.freeItems = [];
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

  async syncCart(userId, itemsList) {
    return runLocked(userId, async () => {
      // --- Fast Path: Pure quantity updates with no coupon applied ---
      // Check upfront if ALL updates are simple qty changes (no deletions, no new items)
      // If so, use a single atomic findOneAndUpdate to halve the number of DB round trips.
      const cart = await Cart.findOne({ user: userId }).lean();

      const hasNoCoupon = !cart?.appliedCoupon;
      const allSimpleUpdates = cart && itemsList.every(({ variantId, quantity }) => {
        const qty = parseInt(quantity);
        if (qty <= 0) return false; // deletion — needs full path
        return cart.items.some(item => item.variantId.toString() === variantId);
      });

      if (hasNoCoupon && allSimpleUpdates) {
        // Build atomic $set operations for each quantity update
        const bulkOps = [];
        let newTotal = 0;

        // Calculate new total using stored prices
        const updatedQtyMap = {};
        for (const { variantId, quantity } of itemsList) {
          updatedQtyMap[variantId] = parseInt(quantity);
        }

        for (const item of cart.items) {
          const vId = item.variantId.toString();
          const qty = updatedQtyMap[vId] ?? item.quantity;
          newTotal += item.price * qty;
        }

        // Build positional update for each variant
        const update = { $set: { totalAmount: newTotal, finalAmount: newTotal } };
        for (const { variantId, quantity } of itemsList) {
          const idx = cart.items.findIndex(i => i.variantId.toString() === variantId);
          if (idx !== -1) {
            update.$set[`items.${idx}.quantity`] = parseInt(quantity);
          }
        }

        const updatedCart = await Cart.findOneAndUpdate(
          { user: userId },
          update,
          { new: true }
        );

        return updatedCart;
      }

      // --- Full Path: New items, deletions, or coupon recalculation ---
      let fullCart = await Cart.findOne({ user: userId });
      if (!fullCart) {
        fullCart = new Cart({ user: userId, items: [], totalAmount: 0 });
      }

      let hasNewItem = false;

      // First pass: identify if any new items need to be added
      for (const itemUpdate of itemsList) {
        const { variantId, quantity } = itemUpdate;
        const targetQuantity = parseInt(quantity);
        if (targetQuantity > 0) {
          const existingItemIndex = fullCart.items.findIndex(item => item.variantId.toString() === variantId);
          if (existingItemIndex === -1) {
            hasNewItem = true;
            break;
          }
        }
      }

      // Only populate if we need product data for a new item
      if (hasNewItem) {
        await fullCart.populate('items.product', 'title brandName technicalName vendor images variants');
      }

      for (const itemUpdate of itemsList) {
        const { variantId, quantity } = itemUpdate;
        const targetQuantity = parseInt(quantity);

        const existingItemIndex = fullCart.items.findIndex(item => item.variantId.toString() === variantId);

        if (targetQuantity <= 0) {
          if (existingItemIndex > -1) {
            fullCart.items.splice(existingItemIndex, 1);
          }
        } else {
          if (existingItemIndex > -1) {
            fullCart.items[existingItemIndex].quantity = targetQuantity;
          } else {
            const product = await Product.findOne({ 'variants._id': variantId });
            if (!product) continue;

            const variant = product.variants.id(variantId);
            if (!variant) continue;

            fullCart.items.push({
              product: product._id,
              variantId: variantId,
              quantity: targetQuantity,
              price: variant.price
            });
          }
        }
      }

      // Re-populate only if new items were added (needed for calculateTotal to read variants)
      if (hasNewItem) {
        await fullCart.populate('items.product', 'title brandName technicalName vendor images variants');
      }

      this.calculateTotal(fullCart);
      await this.recalculateCoupon(fullCart, userId);
      await fullCart.save();
      return fullCart;
    });
  }
}

module.exports = new CartService();

const Cart = require('../models/Cart');
const Product = require('../models/Product');

class CartService {
  async getCart(userId) {
    let cart = await Cart.findOne({ user: userId }).populate('items.product', 'title vendor images');
    if (!cart) {
      cart = await Cart.create({ user: userId, items: [], totalAmount: 0 });
    }
    return cart;
  }

  async addItemsToCart(userId, productId, variantsList) {
    const product = await Product.findById(productId);
    if (!product) throw new Error('Product not found');

    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = new Cart({ user: userId, items: [], totalAmount: 0 });
    }

    for (const v of variantsList) {
      const variant = product.variants.id(v.variantId);
      if (!variant) continue; // Skip if invalid variant ID

      // Check if item already exists in cart with same variant
      const existingItemIndex = cart.items.findIndex(
        item => item.product.toString() === productId && item.variantId.toString() === v.variantId
      );

      if (existingItemIndex > -1) {
        cart.items[existingItemIndex].quantity += (v.quantity || 1);
      } else {
        cart.items.push({
          product: productId,
          variantId: v.variantId,
          quantity: v.quantity || 1,
          price: variant.price
        });
      }
    }

    this.calculateTotal(cart);
    await cart.save();
    return await this.getCart(userId);
  }

  async updateItemQuantity(userId, itemId, quantity) {
    const cart = await Cart.findOne({ user: userId });
    if (!cart) throw new Error('Cart not found');

    const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId);
    if (itemIndex === -1) throw new Error('Item not found in cart');

    if (quantity <= 0) {
      cart.items.splice(itemIndex, 1);
    } else {
      cart.items[itemIndex].quantity = quantity;
    }

    this.calculateTotal(cart);
    await cart.save();
    return await this.getCart(userId);
  }

  async removeItemFromCart(userId, itemId) {
    const cart = await Cart.findOne({ user: userId });
    if (!cart) throw new Error('Cart not found');

    const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId);
    if (itemIndex > -1) {
      cart.items.splice(itemIndex, 1);
    }

    this.calculateTotal(cart);
    await cart.save();
    return await this.getCart(userId);
  }

  async clearCart(userId) {
    const cart = await Cart.findOne({ user: userId });
    if (cart) {
      cart.items = [];
      cart.totalAmount = 0;
      await cart.save();
    }
    return cart;
  }

  calculateTotal(cart) {
    cart.totalAmount = cart.items.reduce((total, item) => total + (item.price * item.quantity), 0);
  }
}

module.exports = new CartService();

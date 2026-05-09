require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const Cart = require('./models/Cart');
const cartService = require('./services/cart.service');

async function testCart() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected.');

    // Find any cart
    const cart = await Cart.findOne({});
    if (!cart) {
      console.log('No cart found in database.');
      return;
    }

    console.log(`Found cart for user: ${cart.user}`);
    console.log('Raw Cart Items in DB before getCart:');
    cart.items.forEach(item => {
      console.log(`- Product ID: ${item.product}, Variant ID: ${item.variantId}, Price: ${item.price}, Qty: ${item.quantity}`);
    });

    // Run getCart
    console.log('\nRunning cartService.getCart...');
    const populatedCart = await cartService.getCart(cart.user);

    console.log('\nCart Items after getCart (populated and healed):');
    populatedCart.items.forEach(item => {
      console.log(`- Product: ${item.product ? item.product.title : 'None'}, Variant: ${item.variant}, Price: ${item.price}, Qty: ${item.qty || item.quantity}`);
    });

    console.log('\nPopulated Cart JSON output (simulating API response):');
    console.log(JSON.stringify(populatedCart, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
  }
}

testCart();

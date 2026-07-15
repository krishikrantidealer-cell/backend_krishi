const Product = require('../models/Product');

async function migrateCustomOrders() {
  try {
    console.log('[Migration] Checking customOrders type consistency in database...');
    
    // Find all products with customOrders populated
    const products = await Product.find({ customOrders: { $exists: true, $ne: null } });
    let migratedCount = 0;
    
    for (const product of products) {
      if (product.customOrders && typeof product.customOrders === 'object') {
        let hasStringValues = false;
        const updatedCustomOrders = {};
        
        for (const [key, val] of Object.entries(product.customOrders)) {
          if (typeof val === 'string') {
            const numVal = Number(val);
            if (!isNaN(numVal)) {
              updatedCustomOrders[key] = numVal;
              hasStringValues = true;
            } else {
              updatedCustomOrders[key] = val;
            }
          } else {
            updatedCustomOrders[key] = val;
          }
        }
        
        if (hasStringValues) {
          product.customOrders = updatedCustomOrders;
          product.markModified('customOrders');
          await product.save();
          migratedCount++;
        }
      }
    }
    
    console.log(`[Migration] customOrders check completed. Migrated ${migratedCount} products to numeric custom orders.`);
  } catch (err) {
    console.error('[Migration] customOrders migration failed with error:', err.message);
  }
}

module.exports = migrateCustomOrders;

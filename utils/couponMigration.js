const Coupon = require('../models/Coupon');
const Product = require('../models/Product');

async function migrateCoupons() {
  try {
    console.log('[Migration] Checking coupon product mappings...');
    
    // Find all coupons with FreeProduct discount type
    const coupons = await Coupon.find({ discountType: 'FreeProduct' });
    
    for (const coupon of coupons) {
      // Ensure quantity is 1 in the database
      if (coupon.freeProductQuantity !== 1) {
        coupon.freeProductQuantity = 1;
        await coupon.save();
        console.log(`[Migration] ✅ Enforced freeProductQuantity = 1 for coupon "${coupon.code}"`);
      }

      // 1. Check if the current freeProductId is valid
      let product = null;
      if (coupon.freeProductId) {
        product = await Product.findById(coupon.freeProductId);
      }
      
      // 2. If product is not found, attempt to automatically re-map
      if (!product) {
        console.log(`[Migration] ⚠️ Coupon "${coupon.code}" has an invalid/missing freeProductId: ${coupon.freeProductId}`);
        
        let searchName = '';
        if (coupon.code === 'DEALERDHAMAKA') {
          searchName = 'Suvirat';
        } else if (coupon.code === 'FREECOMBO') {
          searchName = 'Mix Micronutrient';
        }
        
        if (searchName) {
          const targetProduct = await Product.findOne({ title: new RegExp(searchName, 'i') });
          if (targetProduct) {
            coupon.freeProductId = targetProduct._id;
            await coupon.save();
            console.log(`[Migration] ✅ Successfully re-mapped coupon "${coupon.code}" to product: "${targetProduct.title}" (${targetProduct._id})`);
          } else {
            console.error(`[Migration] ❌ Could not find product matching "${searchName}" for coupon "${coupon.code}"`);
          }
        } else {
          console.warn(`[Migration] ⚠️ No automatic re-mapping target defined for coupon code "${coupon.code}"`);
        }
      } else {
        console.log(`[Migration] Coupon "${coupon.code}" is correctly mapped to product: "${product.title}"`);
      }
    }
    
    console.log('[Migration] Coupon check completed.');
  } catch (err) {
    console.error('[Migration] Coupon migration failed with error:', err.message);
  }
}

module.exports = migrateCoupons;

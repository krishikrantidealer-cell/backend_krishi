const Favourite = require('../models/Favourite');
const Product = require('../models/Product');

class FavouriteService {
  async addFavourite(userId, productId) {
    const product = await Product.findById(productId);
    if (!product) {
      throw new Error('Product not found');
    }

    try {
      const favourite = await Favourite.create({
        user: userId,
        product: productId
      });
      return favourite;
    } catch (error) {
      if (error.code === 11000) {
        throw new Error('Product is already in favourites');
      }
      throw error;
    }
  }

  async removeFavourite(userId, productId) {
    const favourite = await Favourite.findOneAndDelete({
      user: userId,
      product: productId
    });
    
    if (!favourite) {
      throw new Error('Product is not in favourites');
    }
    
    return favourite;
  }

  async getUserFavourites(userId) {
    return await Favourite.find({ user: userId })
      .populate('product', 'title vendor images variants availabilityStatus averageRating')
      .sort({ createdAt: -1 });
  }
}

module.exports = new FavouriteService();

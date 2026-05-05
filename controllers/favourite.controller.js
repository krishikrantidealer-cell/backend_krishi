const favouriteService = require('../services/favourite.service');

exports.addFavourite = async (req, res, next) => {
  try {
    const { productId } = req.body;
    await favouriteService.addFavourite(req.user._id, productId);
    res.status(201).json({
      success: true,
      message: 'Product added to favourites'
    });
  } catch (error) {
    if (error.message === 'Product is already in favourites') {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

exports.removeFavourite = async (req, res, next) => {
  try {
    const { productId } = req.params;
    await favouriteService.removeFavourite(req.user._id, productId);
    res.json({
      success: true,
      message: 'Product removed from favourites'
    });
  } catch (error) {
    if (error.message === 'Product is not in favourites') {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

exports.getFavourites = async (req, res, next) => {
  try {
    const favourites = await favouriteService.getUserFavourites(req.user._id);
    res.json({
      success: true,
      favourites
    });
  } catch (error) {
    next(error);
  }
};

exports.clearFavourites = async (req, res, next) => {
  try {
    await favouriteService.clearFavourites(req.user._id);
    res.json({
      success: true,
      message: 'All favourites cleared successfully'
    });
  } catch (error) {
    next(error);
  }
};

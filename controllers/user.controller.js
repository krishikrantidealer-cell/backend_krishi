const userService = require('../services/user.service');

exports.getProfile = async (req, res, next) => {
  try {
    const user = await userService.getProfile(req.user._id);
    res.json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const user = await userService.updateProfile(req.user._id, req.body);
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    next(error);
  }
};

exports.completeProfile = async (req, res, next) => {
  try {
    const user = await userService.completeProfile(req.user._id, req.body);
    res.json({
      success: true,
      message: 'Account created successfully',
      user
    });
  } catch (error) {
    next(error);
  }
};

exports.submitKyc = async (req, res, next) => {
  try {
    const user = await userService.submitKyc(req.user._id, req.body);
    res.json({
      success: true,
      message: 'KYC submitted successfully',
      user
    });
  } catch (error) {
    next(error);
  }
};

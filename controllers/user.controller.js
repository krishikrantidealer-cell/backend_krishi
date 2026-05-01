const userService = require('../services/user.service');
const { processAndUploadKycDocument } = require('../utils/gcs');

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
    const kycData = req.body;
    
    // Handle File Upload to GCS
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Licence image file is required' });
    }

    const licenceImageUrl = await processAndUploadKycDocument(
      req.file.buffer, 
      req.file.originalname, 
      req.user._id
    );

    // Add the GCS URL to kycData before calling service
    kycData.licenceImage = licenceImageUrl;

    const user = await userService.submitKyc(req.user._id, kycData);
    
    res.json({
      success: true,
      message: 'KYC submitted successfully',
      user
    });
  } catch (error) {
    next(error);
  }
};

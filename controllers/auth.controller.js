const User = require('../models/User');
const authService = require('../services/auth.service');
const tokenService = require('../services/token.service');
const uap = require('ua-parser-js');

class AuthController {
  // @desc    Send OTP to phone number
  // @route   POST /api/auth/send-otp
  async sendOTP(req, res) {
    try {
      const { phoneNumber } = req.body;
      const otp = await authService.sendOTP(phoneNumber);
      
      res.status(200).json({ 
        success: true, 
        message: 'OTP sent successfully',
        // In production, don't return the OTP in response
        otp: process.env.NODE_ENV === 'development' ? otp : undefined 
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  // @desc    Verify OTP and Login/Register
  // @route   POST /api/auth/verify-otp
  async verifyOTP(req, res) {
    try {
      const { phoneNumber, otp, deviceId } = req.body;
      
      // 1. Verify OTP
      await authService.verifyOTP(phoneNumber, otp);

      // 2. Find or Create User
      let user = await User.findOne({ phoneNumber });
      if (!user) {
        user = await User.create({ 
          phoneNumber,
          isVerified: true 
        });
      } else if (!user.isVerified) {
        user.isVerified = true;
        await user.save();
      }

      // 3. Create Session
      const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];
      
      const tokens = await tokenService.createSession(
        user._id, 
        deviceId, 
        ipAddress, 
        userAgent
      );

      res.status(200).json({
        success: true,
        user: {
          id: user._id,
          phoneNumber: user.phoneNumber,
          isVerified: user.isVerified,
          role: user.role
        },
        ...tokens
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  // @desc    Refresh Access Token
  // @route   POST /api/auth/refresh
  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        return res.status(400).json({ success: false, message: 'Refresh token is required' });
      }

      const ipAddress = req.ip || req.headers['x-forwarded-for'];
      const userAgent = req.headers['user-agent'];

      const tokens = await tokenService.rotateToken(refreshToken, ipAddress, userAgent);

      res.status(200).json({
        success: true,
        ...tokens
      });
    } catch (error) {
      res.status(401).json({ success: false, message: error.message });
    }
  }

  // @desc    Logout current device
  // @route   POST /api/auth/logout
  async logout(req, res) {
    try {
      // 1. Blacklist the current access token
      const token = req.headers.authorization.split(' ')[1];
      // Access tokens expire in 15m, so we blacklist for 15m (900s)
      await tokenService.blacklistAccessToken(token, 900);

      // 2. Delete the session (refresh token)
      await tokenService.deleteSession(req.user._id, req.deviceId);
      
      res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Logout failed' });
    }
  }

  // @desc    Logout all devices
  // @route   POST /api/auth/logout-all
  async logoutAll(req, res) {
    try {
      await tokenService.deleteAllSessions(req.user._id);
      res.status(200).json({ success: true, message: 'Logged out from all devices' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Logout all failed' });
    }
  }

  // @desc    Get all active sessions
  // @route   GET /api/auth/sessions
  async getSessions(req, res) {
    try {
      const sessions = await tokenService.getSessions(req.user._id);
      res.status(200).json({
        success: true,
        sessions
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch sessions' });
    }
  }
}

module.exports = new AuthController();

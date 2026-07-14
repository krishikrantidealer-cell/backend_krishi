const User = require('../models/User');
const authService = require('../services/auth.service');
const tokenService = require('../services/token.service');
const uap = require('ua-parser-js');

class AuthController {
  async adminLogin(req, res) {
    try {
      const { email, password, deviceId } = req.body;

      const user = await User.findOne({ email, isDeleted: { $ne: true } });
      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      if (user.isBlocked) {
        return res.status(403).json({ success: false, message: 'Your account has been blocked. Access denied.' });
      }

      if (user.role !== 'admin' && user.role !== 'sales') {
        return res.status(403).json({ success: false, message: 'Access denied: insufficient permissions' });
      }

      const { compareData } = require('../utils/hash');
      const isMatch = await compareData(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];
      
      const tokens = await tokenService.createSession(
        user._id, 
        deviceId || 'admin-console', 
        ipAddress, 
        userAgent
      );

      res.status(200).json({
        success: true,
        user: {
          id: user._id,
          email: user.email,
          phoneNumber: user.phoneNumber,
          isVerified: user.isVerified,
          isProfileComplete: user.isProfileComplete,
          isKycComplete: user.isKycComplete,
          role: user.role
        },
        ...tokens
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async sendOTP(req, res) {
    try {
      const { phoneNumber } = req.body;
      const otp = await authService.sendOTP(phoneNumber);
      
      res.status(200).json({ 
        success: true, 
        message: 'OTP sent successfully',
        cooldown: 60, // Tell frontend to wait 60 seconds
        otp: process.env.NODE_ENV === 'development' ? otp : undefined 
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async verifyOTP(req, res) {
    try {
      const { phoneNumber, otp, deviceId } = req.body;
      
      await authService.verifyOTP(phoneNumber, otp);

      let user = await User.findOne({ phoneNumber, isDeleted: { $ne: true } });
      if (user && user.isBlocked) {
        return res.status(403).json({ success: false, message: 'Your account has been blocked. Access denied.' });
      }
      let isNewUser = false;
      const isTestPhone = phoneNumber === '9999999999';
      if (!user) {
        user = await User.create({ 
          phoneNumber,
          isVerified: true,
          ...(isTestPhone && {
            isProfileComplete: true,
            isKycComplete: true,
            kycStatus: 'verified',
            userType: 'retailer',
            firstName: 'App Store',
            lastName: 'Reviewer',
            shopName: 'App Store Testing',
            shopAddress: 'Testing Address',
            address: {
              villageArea: 'Testing Area',
              cityTehsil: 'Testing City',
              pincode: '110001'
            }
          })
        });
        isNewUser = true;
      } else if (!user.isVerified || isTestPhone) {
        const wasVerified = user.isVerified;
        user.isVerified = true;
        if (isTestPhone) {
          user.isProfileComplete = true;
          user.isKycComplete = true;
          user.kycStatus = 'verified';
          user.userType = 'retailer';
          if (!user.firstName) user.firstName = 'App Store';
          if (!user.lastName) user.lastName = 'Reviewer';
          if (!user.shopName) user.shopName = 'App Store Testing';
        }
        await user.save();
        isNewUser = !wasVerified;
      }

      if (isNewUser) {
        try {
          const { sendToAll } = require('../services/websocket.service');
          sendToAll({ type: 'LEADS_UPDATE' });
        } catch (wsErr) {
          console.error('[WS] Failed to broadcast new lead:', wsErr.message);
        }
      }

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
          isProfileComplete: user.isProfileComplete,
          isKycComplete: user.isKycComplete,
          role: user.role
        },
        ...tokens
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

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

  async logout(req, res) {
    try {
      const token = req.headers.authorization.split(' ')[1];
      // Access tokens expire in 15m, so we blacklist for 15m (900s)
      await tokenService.blacklistAccessToken(token, 900);

      await tokenService.deleteSession(req.user._id, req.deviceId);
      
      res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Logout failed' });
    }
  }

  async logoutAll(req, res) {
    try {
      await tokenService.deleteAllSessions(req.user._id);
      res.status(200).json({ success: true, message: 'Logged out from all devices' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Logout all failed' });
    }
  }

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

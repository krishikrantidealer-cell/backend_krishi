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
          firstName: user.firstName,
          lastName: user.lastName,
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

      if (!user) {
        // Look for soft-deleted user in trash with matching phone prefix
        const deleteRegex = /_deleted_\d+$/;
        const phoneEscaped = phoneNumber.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const deletedUser = await User.findOne({
          isDeleted: true,
          phoneNumber: { $regex: `^${phoneEscaped}_deleted_\\d+$` }
        });

        if (deletedUser) {
          // Restore the user document
          const restoredPhone = deletedUser.phoneNumber.replace(deleteRegex, '');
          const restoredEmail = deletedUser.email ? deletedUser.email.replace(deleteRegex, '') : undefined;

          deletedUser.phoneNumber = restoredPhone;
          if (deletedUser.email) {
            deletedUser.email = restoredEmail;
          }
          deletedUser.isDeleted = false;
          deletedUser.deletedAt = undefined;

          await deletedUser.save();
          user = deletedUser;

          // Audit Log: User Auto-Restored upon login
          try {
            const auditService = require('../services/audit.service');
            auditService.logAction({
              adminId: null, // SYSTEM ACTION
              adminEmail: 'SYSTEM_AUTO_RESTORE',
              action: 'USER_RESTORED',
              targetId: user._id,
              targetModel: 'User',
              details: `Auto-restored user account from trash upon login attempt: ${user.firstName || ''} ${user.lastName || ''}`.trim(),
              changes: { after: { isDeleted: false, phoneNumber: restoredPhone } }
            }, req);
          } catch (auditErr) {
            console.error('Failed to write audit log for auto-restored user:', auditErr.message);
          }

          // Real-time broadcasts to admin panel
          try {
            const { broadcastToRoles } = require('../services/websocket.service');
            broadcastToRoles(['admin', 'sales'], { type: 'LEADS_UPDATE' });
            broadcastToRoles(['admin', 'sales'], { type: 'DEALERS_UPDATE' });
            broadcastToRoles(['admin', 'sales'], { type: 'TRASH_UPDATE' });
          } catch (wsErr) {
            console.error('[WS] Failed to broadcast user auto-restore:', wsErr.message);
          }
        }
      }

      if (user && user.isBlocked) {
        return res.status(403).json({ success: false, message: 'Your account has been blocked. Access denied.' });
      }
      let isNewUser = false;
      const isTestPhone = phoneNumber === '9999999999';
      if (!user) {
        const deepLinkUrl = req.body.deepLinkUrl || req.body.deep_link_url || null;
        let utmSource = req.body.utm_source || req.body.utmSource || null;
        let utmMedium = req.body.utm_medium || req.body.utmMedium || null;
        let utmCampaign = req.body.utm_campaign || req.body.utmCampaign || null;
        let utmTerm = req.body.utm_term || req.body.utmTerm || null;
        let utmContent = req.body.utm_content || req.body.utmContent || null;

        const cleanUtmVal = (val) => {
          if (!val) return null;
          const trimmed = val.trim().toLowerCase();
          if (['(not set)', '(notset)', 'not set', 'not_set', 'notset', 'none', 'null', 'undefined', 'organic'].includes(trimmed)) {
            return null;
          }
          try {
            const decoded = decodeURIComponent(val);
            if (decoded.startsWith('{') && decoded.endsWith('}')) {
              const parsed = JSON.parse(decoded);
              if (parsed.app) return `Meta App ID: ${parsed.app}`;
            }
            return decoded.length > 80 ? `${decoded.substring(0, 75)}...` : decoded;
          } catch (e) {
            return val.length > 80 ? `${val.substring(0, 75)}...` : val;
          }
        };

        const urlToParse = deepLinkUrl || req.body.source || '';
        if (urlToParse && (urlToParse.includes('?') || urlToParse.includes('='))) {
          try {
            const searchStr = urlToParse.includes('?') ? urlToParse.split('?')[1] : urlToParse;
            const params = new URLSearchParams(searchStr);
            if (!utmSource) utmSource = params.get('utm_source');
            if (!utmMedium) utmMedium = params.get('utm_medium');
            if (!utmCampaign) utmCampaign = params.get('utm_campaign');
            if (!utmTerm) utmTerm = params.get('utm_term');
            if (!utmContent) utmContent = params.get('utm_content');
          } catch (e) {}
        }

        utmSource = cleanUtmVal(utmSource);
        utmMedium = cleanUtmVal(utmMedium);
        utmCampaign = cleanUtmVal(utmCampaign);
        utmTerm = cleanUtmVal(utmTerm);
        utmContent = cleanUtmVal(utmContent);

        user = await User.create({ 
          phoneNumber,
          isVerified: true,
          source: req.body.source || (utmSource ? `UTM: ${utmSource}` : 'App'),
          deepLinkUrl,
          utmSource,
          utmMedium,
          utmCampaign,
          utmTerm,
          utmContent,
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
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
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

  async resetPassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long' });
      }
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: 'Current password is required' });
      }

      const user = await User.findById(req.user._id).select('+password');
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // Verify current password
      const { compareData } = require('../utils/hash');
      const isMatch = await compareData(currentPassword, user.password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Incorrect current password' });
      }

      const { hashData } = require('../utils/hash');
      const hashedPassword = await hashData(newPassword);

      user.password = hashedPassword;
      await user.save();

      // Audit Log: Password Reset
      try {
        const auditService = require('../services/audit.service');
        auditService.logAction({
          adminId: user._id,
          adminEmail: user.email,
          action: 'PASSWORD_RESET_SELF',
          targetId: user._id,
          targetModel: 'User',
          details: `User reset their own password: ${user.firstName || ''} ${user.lastName || ''}`.trim(),
        }, req);
      } catch (auditErr) {
        console.error('Failed to write audit log for self password reset:', auditErr.message);
      }

      res.status(200).json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new AuthController();

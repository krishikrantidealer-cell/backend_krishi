const Session = require('../models/Session');
const User = require('../models/User');
const { redisClient } = require('../config/redis');
const { hashData, compareData } = require('../utils/hash');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');

const REFRESH_TOKEN_EXPIRY = 30 * 24 * 60 * 60; // 30 days in seconds

class TokenService {
  /**
   * Create a new session and store refresh token in Redis & MongoDB
   */
  async createSession(userId, deviceId, ipAddress, userAgent) {
    // Limit max 3 devices in MongoDB (Source of truth for active devices)
    const sessionCount = await Session.countDocuments({ userId });
    if (sessionCount >= 3) {
      const oldestSession = await Session.findOne({ userId }).sort({ createdAt: 1 });
      if (oldestSession) {
        // Invalidate in Redis before deleting from DB
        await redisClient.del(`session:${userId}:${oldestSession.deviceId}`);
        await Session.deleteOne({ _id: oldestSession._id });
      }
    }

    const refreshToken = generateRefreshToken({ userId, deviceId });
    const refreshTokenHash = await hashData(refreshToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    // Store in MongoDB
    await Session.findOneAndUpdate(
      { userId, deviceId },
      {
        refreshTokenHash,
        ipAddress,
        userAgent,
        lastUsed: new Date(),
        expiresAt
      },
      { upsert: true, new: true }
    );

    // Store in Redis for fast lookup
    await redisClient.set(`session:${userId}:${deviceId}`, refreshTokenHash, {
      EX: REFRESH_TOKEN_EXPIRY
    });

    const accessToken = generateAccessToken({ userId, deviceId });

    return { accessToken, refreshToken };
  }

  /**
   * Rotate refresh token with reuse detection via Redis & MongoDB
   */
  async rotateToken(oldRefreshToken, ipAddress, userAgent) {
    const decoded = verifyRefreshToken(oldRefreshToken);
    if (!decoded) {
      throw new Error('Invalid refresh token');
    }

    const { userId, deviceId } = decoded;

    // Verify user still exists in database
    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
      await this.deleteSession(userId, deviceId);
      throw new Error('User not found');
    }

    const redisKey = `session:${userId}:${deviceId}`;

    // 1. Check Redis first (fast path)
    let storedHash = await redisClient.get(redisKey);

    // 2. Fallback to MongoDB if Redis cache is empty (unlikely but robust)
    if (!storedHash) {
      const session = await Session.findOne({ userId, deviceId });
      if (!session) throw new Error('Session not found');
      storedHash = session.refreshTokenHash;
      // Repopulate Redis
      await redisClient.set(redisKey, storedHash, { EX: REFRESH_TOKEN_EXPIRY });
    }

    // 3. Reuse detection
    const isMatch = await compareData(oldRefreshToken, storedHash);
    if (!isMatch) {
      // TOKEN REUSE DETECTED!
      // Blacklist this token and invalidate all sessions for safety
      await this.deleteAllSessions(userId);
      throw new Error('Token reuse detected. All sessions invalidated for security.');
    }

    // 4. Generate new tokens
    const newRefreshToken = generateRefreshToken({ userId, deviceId });
    const newRefreshTokenHash = await hashData(newRefreshToken);
    const newAccessToken = generateAccessToken({ userId, deviceId });

    // 5. Update MongoDB
    await Session.findOneAndUpdate(
      { userId, deviceId },
      {
        refreshTokenHash: newRefreshTokenHash,
        ipAddress,
        userAgent,
        lastUsed: new Date()
      }
    );

    // 6. Update Redis
    await redisClient.set(redisKey, newRefreshTokenHash, {
      EX: REFRESH_TOKEN_EXPIRY
    });

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  /**
   * Invalidate a single session
   */
  async deleteSession(userId, deviceId) {
    await redisClient.del(`session:${userId}:${deviceId}`);
    await Session.deleteOne({ userId, deviceId });
  }

  /**
   * Invalidate all sessions for a user
   */
  async deleteAllSessions(userId) {
    const sessions = await Session.find({ userId });
    for (const session of sessions) {
      await redisClient.del(`session:${userId}:${session.deviceId}`);
    }
    await Session.deleteMany({ userId });
  }

  /**
   * Blacklist an access token (used on logout)
   */
  async blacklistAccessToken(token, expiresInSeconds) {
    const key = `blacklist:${token}`;
    await redisClient.set(key, '1', {
      EX: expiresInSeconds > 0 ? expiresInSeconds : 3600 // default 1h if expired
    });
  }

  /**
   * Check if an access token is blacklisted
   */
  /**
   * Check if an access token is blacklisted
   */
  async isTokenBlacklisted(token) {
    const result = await redisClient.get(`blacklist:${token}`);
    return result === '1';
  }

  /**
   * Get all active sessions for a user
   */
  async getSessions(userId) {
    return await Session.find({ userId })
      .select('deviceId ipAddress userAgent lastUsed createdAt')
      .sort({ lastUsed: -1 });
  }
}

module.exports = new TokenService();

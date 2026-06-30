const AuditLog = require('../models/AuditLog');

/**
 * Enterprise Audit Logging Service
 * Records critical admin actions for security and operational visibility.
 */
class AuditService {
  /**
   * Log an admin action
   * @param {Object} data
   * @param {string} data.adminId - ID of the admin performing the action
   * @param {string} data.adminEmail - Email of the admin
   * @param {string} data.action - Action name (e.g., 'PRICE_UPDATED')
   * @param {string} [data.targetId] - ID of the object being changed
   * @param {string} [data.targetModel] - Model name of the object
   * @param {Object} [data.changes] - before/after state
   * @param {Object} [req] - Express request object for IP and UserAgent
   */
  async logAction({ adminId, adminEmail, action, targetId, targetModel, changes }, req = null) {
    try {
      const log = await AuditLog.create({
        adminId,
        adminEmail,
        action,
        targetId,
        targetModel,
        changes,
        ipAddress: req ? req.ip || req.headers['x-forwarded-for'] : null,
        userAgent: req ? req.headers['user-agent'] : null,
        timestamp: new Date()
      });
      return log;
    } catch (error) {
      console.error('[AuditService] Failed to record audit log:', error);
      // We don't throw here to avoid breaking the main business flow
      // but in some systems, audit failure must stop the action.
    }
  }

  /**
   * Fetch logs for a specific object (e.g., history of a product)
   */
  async getHistoryForTarget(targetId) {
    return await AuditLog.find({ targetId })
      .sort({ timestamp: -1 });
  }
}

module.exports = new AuditService();

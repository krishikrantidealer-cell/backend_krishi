/**
 * Role & Granular Permission Middleware
 * Evaluates whether the authenticated user has permission to perform the requested action.
 * Admins are automatically granted all permissions.
 *
 * @param {string} module - "lead" or "dealer"
 * @param {string} action - "create", "update", "reassign", "delete", "viewUnassigned"
 */
const checkPermission = (module, action) => {
  return (req, res, next) => {
    // 1. Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    // 2. Admins have unconditional full access
    if (req.user.role === "admin") {
      return next();
    }

    // 3. Evaluate sales agent permissions
    if (req.user.role === "sales") {
      const perms = req.user.permissions;
      
      // If no custom permissions are set, apply default standard rules
      if (!perms) {
        if (action === "reassign" || action === "viewUnassigned" || action === "unassigned") {
          return res.status(403).json({
            success: false,
            message: `You do not have permission to ${action} ${module}s.`
          });
        }
        return next(); // create, update, delete are default true
      }

      const moduleKey = module.toLowerCase();
      const modulePerms = perms[moduleKey] || perms[`${moduleKey}s`] || perms[moduleKey === "lead" ? "leads" : "dealers"];

      if (modulePerms && modulePerms[action] !== undefined) {
        const hasAccess = modulePerms[action] === true || modulePerms[action] === "true" || modulePerms[action] === 1;
        if (hasAccess) {
          return next();
        }
      } else {
        // Standard defaults if action key missing
        if (action !== "reassign" && action !== "viewUnassigned" && action !== "unassigned") {
          return next();
        }
      }

      return res.status(403).json({
        success: false,
        message: `Access Denied: You do not have ${action} permission for ${module}s.`
      });
    }

    // 4. Other roles denied by default
    return res.status(403).json({
      success: false,
      message: "Insufficient role privileges."
    });
  };
};

module.exports = {
  checkPermission
};

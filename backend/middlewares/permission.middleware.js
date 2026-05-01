const { normalizeRoleKey } = require("../helpers/permissions");
const { userHasPermission } = require("../services/permission.service");

const requirePermission = (moduleKey, action) => async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const allowed = await userHasPermission(req.user, moduleKey, action);
    if (!allowed) {
      return res.status(403).json({
        message: `Permission denied: ${moduleKey}.${action} is required.`,
      });
    }

    return next();
  } catch (error) {
    console.error("Permission check error:", error);
    return res.status(500).json({ message: "Failed to verify permissions" });
  }
};

const requireAdminOnlyPisEdit = (req, res, next) => {
  const roleKey = normalizeRoleKey(req.user?.role);
  if (roleKey !== "admin") {
    return res.status(403).json({
      message: "PIS data edit/update/import/sync is admin-only.",
    });
  }

  return next();
};

const requireAdminOnlyPermissionManagement = (req, res, next) => {
  const roleKey = normalizeRoleKey(req.user?.role);
  if (roleKey !== "admin") {
    return res.status(403).json({
      message: "Permission management is admin-only.",
    });
  }

  return next();
};

module.exports = {
  requireAdminOnlyPermissionManagement,
  requireAdminOnlyPisEdit,
  requirePermission,
};

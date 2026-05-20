const { canRoleUsePisAction, normalizeRoleKey } = require("../helpers/permissions");
const { isAdminLikeRole, normalizeUserRoleKey } = require("../helpers/userRole");
const { userHasPermission } = require("../services/permission.service");

const SHIPMENT_EDIT_ROLE_KEYS = new Set([
  "admin",
  "super_admin",
  "inspection_manager",
]);

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

const requirePermissionOrRoles = (moduleKey, action, roleKeys = []) => async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const allowed = await userHasPermission(req.user, moduleKey, action);
    const shipmentEditAllowed =
      action === "edit" &&
      moduleKey !== "shipments" &&
      await userHasPermission(req.user, "shipments", "edit");
    const roleKey = normalizeUserRoleKey(req.user?.role);
    const allowedRoles = new Set(roleKeys.map((role) => normalizeUserRoleKey(role)));
    if (!allowed && !shipmentEditAllowed && !allowedRoles.has(roleKey)) {
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

const requireShipmentEditAccess = (moduleKey = "shipments") =>
  requirePermissionOrRoles(moduleKey, "edit", Array.from(SHIPMENT_EDIT_ROLE_KEYS));

const requireAdminOnlyPisEdit = (req, res, next) => {
  const roleKey = normalizeRoleKey(req.user?.role);
  const canEditPis = canRoleUsePisAction(roleKey, "edit");
  const canUploadPis = canRoleUsePisAction(roleKey, "upload");
  if (!canEditPis && !canUploadPis) {
    return res.status(403).json({
      message: "PIS data edit/update/upload is restricted to authorized roles.",
    });
  }

  return next();
};

const requireAdminOnlyPermissionManagement = (req, res, next) => {
  const roleKey = normalizeRoleKey(req.user?.role);
  if (!isAdminLikeRole(roleKey)) {
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
  requirePermissionOrRoles,
  requireShipmentEditAccess,
};

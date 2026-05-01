const {
  getAllRolePermissions,
  getEffectivePermissionsForUser,
  resetRolePermissions,
  saveRolePermissions,
} = require("../services/permission.service");
const { ROLE_KEYS, normalizeRoleKey } = require("../helpers/permissions");

const getPermissions = async (_req, res) => {
  try {
    const payload = await getAllRolePermissions();
    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error("Get permissions error:", error);
    return res.status(500).json({ message: "Failed to fetch permissions" });
  }
};

const getMyPermissions = async (req, res) => {
  try {
    const payload = await getEffectivePermissionsForUser(req.user);
    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error("Get current permissions error:", error);
    return res.status(500).json({ message: "Failed to fetch current permissions" });
  }
};

const updateRolePermissions = async (req, res) => {
  try {
    const role = normalizeRoleKey(req.params.role);
    if (!ROLE_KEYS.includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const updated = await saveRolePermissions({
      role,
      permissions: req.body?.permissions || {},
      actor: req.user,
      auditAction: "update",
    });

    return res.json({
      success: true,
      role: updated,
      message: "Permissions updated successfully",
    });
  } catch (error) {
    console.error("Update permissions error:", error);
    return res.status(500).json({ message: "Failed to update permissions" });
  }
};

const resetRolePermissionDefaults = async (req, res) => {
  try {
    const role = normalizeRoleKey(req.params.role);
    if (!ROLE_KEYS.includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const updated = await resetRolePermissions({ role, actor: req.user });
    return res.json({
      success: true,
      role: updated,
      message: "Permissions reset to default",
    });
  } catch (error) {
    console.error("Reset permissions error:", error);
    return res.status(500).json({ message: "Failed to reset permissions" });
  }
};

module.exports = {
  getMyPermissions,
  getPermissions,
  resetRolePermissionDefaults,
  updateRolePermissions,
};

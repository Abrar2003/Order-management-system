const { normalizeUserRoleKey } = require("../helpers/userRole");

const MANAGER_PEER_ROLE_KEYS = Object.freeze([
  "manager",
  "product_manager",
  "inspection_manager",
]);

const expandAllowedRoleKeys = (allowedRoles = []) => {
  const roleKeys = new Set();

  allowedRoles.forEach((role) => {
    const roleKey = normalizeUserRoleKey(role);
    if (roleKey === "manager") {
      MANAGER_PEER_ROLE_KEYS.forEach((managerRoleKey) => roleKeys.add(managerRoleKey));
      return;
    }
    roleKeys.add(roleKey);
  });

  return roleKeys;
};

const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    const normalizedUserRole = normalizeUserRoleKey(req.user?.role);
    const normalizedAllowedRoles = expandAllowedRoleKeys(allowedRoles);

    if (!normalizedAllowedRoles.has(normalizedUserRole)) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };
};

module.exports = authorize;

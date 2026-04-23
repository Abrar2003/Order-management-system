const { normalizeUserRoleKey } = require("../helpers/userRole");

const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    const normalizedUserRole = normalizeUserRoleKey(req.user?.role);
    const normalizedAllowedRoles = allowedRoles.map((role) => normalizeUserRoleKey(role));

    if (!normalizedAllowedRoles.includes(normalizedUserRole)) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };
};

module.exports = authorize;

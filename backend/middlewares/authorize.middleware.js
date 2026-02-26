const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    const normalizedUserRole = String(req.user?.role || "")
      .trim()
      .toLowerCase();
    const normalizedAllowedRoles = allowedRoles.map((role) =>
      String(role || "")
        .trim()
        .toLowerCase(),
    );

    if (!normalizedAllowedRoles.includes(normalizedUserRole)) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };
};

module.exports = authorize;

const USER_ROLES = Object.freeze(["admin", "manager", "QC", "dev", "user"]);

const normalizeUserRole = (value, fallback = "") => {
  const normalizedRole = String(value || "").trim();
  if (!normalizedRole) return fallback;

  const canonicalRoles = {
    admin: "admin",
    manager: "manager",
    qc: "QC",
    dev: "dev",
    user: "user",
  };

  return canonicalRoles[normalizedRole.toLowerCase()] || fallback;
};

const normalizeUserRoleKey = (value) =>
  String(normalizeUserRole(value) || "")
    .trim()
    .toLowerCase();

module.exports = {
  USER_ROLES,
  normalizeUserRole,
  normalizeUserRoleKey,
};

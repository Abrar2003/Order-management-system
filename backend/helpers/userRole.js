const USER_ROLES = Object.freeze([
  "admin",
  "manager",
  "product manager",
  " ",
  "super admin",
  "QC",
  "dev",
  "user",
]);

const CANONICAL_ROLES = Object.freeze({
  admin: "admin",
  manager: "manager",
  "product manager": "product manager",
  "product manger": "product manager",
  product_manager: "product manager",
  product_manger: "product manager",
  "inspection manager": "inspection manager",
  "inspection manger": "inspection manager",
  inspection_manager: "inspection manager",
  inspection_manger: "inspection manager",
  "operation manager": "inspection manager",
  "operation manger": "inspection manager",
  operation_manager: "inspection manager",
  operation_manger: "inspection manager",
  "super admin": "super admin",
  super_admin: "super admin",
  qc: "QC",
  dev: "dev",
  user: "user",
});

const SUPER_ADMIN_LIKE_ROLE_KEYS = Object.freeze(["super_admin"]);
const ADMIN_LIKE_ROLE_KEYS = Object.freeze(["admin", ...SUPER_ADMIN_LIKE_ROLE_KEYS]);
const MANAGER_LIKE_ROLE_KEYS = Object.freeze([
  ...ADMIN_LIKE_ROLE_KEYS,
  "manager",
  "product_manager",
  "inspection_manager",
  "operation_manager",
]);

const normalizeUserRole = (value, fallback = "") => {
  const normalizedRole = String(value || "").trim();
  if (!normalizedRole) return fallback;

  const normalizedKey = normalizedRole
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  return (
    CANONICAL_ROLES[normalizedRole.toLowerCase()]
    || CANONICAL_ROLES[normalizedKey]
    || fallback
  );
};

const normalizeUserRoleKey = (value) =>
  String(normalizeUserRole(value) || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const isSuperAdminLikeRole = (value) =>
  SUPER_ADMIN_LIKE_ROLE_KEYS.includes(normalizeUserRoleKey(value));

const isAdminLikeRole = (value) =>
  ADMIN_LIKE_ROLE_KEYS.includes(normalizeUserRoleKey(value));

const isManagerLikeRole = (value) =>
  MANAGER_LIKE_ROLE_KEYS.includes(normalizeUserRoleKey(value));

module.exports = {
  ADMIN_LIKE_ROLE_KEYS,
  MANAGER_LIKE_ROLE_KEYS,
  SUPER_ADMIN_LIKE_ROLE_KEYS,
  USER_ROLES,
  isAdminLikeRole,
  isManagerLikeRole,
  isSuperAdminLikeRole,
  normalizeUserRole,
  normalizeUserRoleKey,
};

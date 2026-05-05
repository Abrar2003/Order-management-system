export const ROLE_LABELS = Object.freeze({
  admin: "Admin",
  super_admin: "Super Admin",
  manager: "Manager",
  product_manager: "Product Manager",
  inspection_manager: "Inspection Manager",
  qc: "QC",
  dev: "Dev",
  user: "User",
});

export const USER_ROLE_OPTIONS = Object.freeze([
  { value: "admin", label: ROLE_LABELS.admin },
  { value: "super_admin", label: ROLE_LABELS.super_admin },
  { value: "manager", label: ROLE_LABELS.manager },
  { value: "product_manager", label: ROLE_LABELS.product_manager },
  { value: "inspection_manager", label: ROLE_LABELS.inspection_manager },
  { value: "qc", label: ROLE_LABELS.qc },
  { value: "dev", label: ROLE_LABELS.dev },
  { value: "user", label: ROLE_LABELS.user },
]);

const ROLE_ALIASES = Object.freeze({
  admin: "admin",
  super_admin: "super_admin",
  "super admin": "super_admin",
  manager: "manager",
  product_manager: "product_manager",
  "product manager": "product_manager",
  "product manger": "product_manager",
  inspection_manager: "inspection_manager",
  "inspection manager": "inspection_manager",
  "inspection manger": "inspection_manager",
  operation_manager: "inspection_manager",
  "operation manager": "inspection_manager",
  "operation manger": "inspection_manager",
  qc: "qc",
  dev: "dev",
  user: "user",
});

export const normalizeUserRole = (role) => {
  const normalized = String(role || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "";

  const normalizedKey = normalized.replace(/[\s-]+/g, "_");
  return ROLE_ALIASES[normalized] || ROLE_ALIASES[normalizedKey] || normalizedKey;
};

export const isViewOnlyUserRole = (role) =>
  normalizeUserRole(role) === "user";

export const isViewOnlyUser = (user) => isViewOnlyUserRole(user?.role);

export const isQcOnlyUserRole = (role) =>
  normalizeUserRole(role) === "qc";

export const isAdminLikeRole = (role) =>
  ["admin", "super_admin"].includes(normalizeUserRole(role));

export const isManagerLikeRole = (role) =>
  isAdminLikeRole(role)
  || ["manager", "product_manager", "inspection_manager"].includes(
    normalizeUserRole(role),
  );

export const hasShipmentPrivilegeRole = (role) =>
  isManagerLikeRole(role) || normalizeUserRole(role) === "dev";

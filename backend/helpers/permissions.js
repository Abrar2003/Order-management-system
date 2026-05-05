const {
  isAdminLikeRole,
  isSuperAdminLikeRole,
  normalizeUserRoleKey,
} = require("./userRole");

// Add new permission modules/actions here first, then guard routes with
// requirePermission(module, action). PIS mutation actions are deliberately
// hard-locked for non-admin roles both here and in permission.middleware.js.
const PERMISSION_ACTIONS = Object.freeze([
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "upload",
  "export",
  "assign",
  "sync",
  "manage",
]);

const PERMISSION_MODULES = Object.freeze([
  { key: "dashboard", label: "Dashboard" },
  { key: "orders", label: "Orders" },
  { key: "qc", label: "QC" },
  { key: "inspections", label: "Inspections" },
  { key: "items", label: "Items" },
  { key: "product_database", label: "Product Database" },
  { key: "product_type_templates", label: "Product Type Templates" },
  { key: "workflow", label: "Workflow" },
  { key: "pis", label: "PIS" },
  { key: "uploads", label: "Uploads" },
  { key: "shipments", label: "Shipments" },
  { key: "containers", label: "Containers" },
  { key: "samples", label: "Samples" },
  { key: "reports", label: "Reports" },
  { key: "calendar", label: "Calendar" },
  { key: "users", label: "Users" },
  { key: "settings", label: "Settings" },
  { key: "brands", label: "Brands" },
  { key: "finishes", label: "Finishes" },
  { key: "images_documents", label: "Images / Documents" },
  { key: "labels", label: "Labels" },
  { key: "jobs", label: "Jobs" },
  { key: "permissions", label: "Permission Management" },
]);

const ROLE_KEYS = Object.freeze([
  "admin",
  "super_admin",
  "manager",
  "product_manager",
  "inspection_manager",
  "user",
  "qc",
  "dev",
]);

const PIS_ADMIN_ONLY_ACTIONS = Object.freeze([
  "create",
  "edit",
  "delete",
  "approve",
  "upload",
  "sync",
  "manage",
]);

const PRODUCT_TYPE_TEMPLATE_ADMIN_ONLY_ACTIONS = Object.freeze([
  "create",
  "edit",
  "delete",
  "approve",
  "upload",
  "export",
  "assign",
  "sync",
  "manage",
]);

const WORKFLOW_ADMIN_ONLY_ACTIONS = Object.freeze([
  "approve",
  "delete",
]);

const PERMISSION_ADMIN_ONLY_ACTIONS = Object.freeze(PERMISSION_ACTIONS);

const moduleKeys = new Set(PERMISSION_MODULES.map((module) => module.key));
const actionKeys = new Set(PERMISSION_ACTIONS);

const clone = (value) => JSON.parse(JSON.stringify(value || {}));

const createEmptyModulePermissions = () =>
  PERMISSION_ACTIONS.reduce((acc, action) => {
    acc[action] = false;
    return acc;
  }, {});

const createEmptyPermissions = () =>
  PERMISSION_MODULES.reduce((acc, module) => {
    acc[module.key] = createEmptyModulePermissions();
    return acc;
  }, {});

const grant = (permissions, moduleKey, actions = []) => {
  if (!permissions[moduleKey]) return;
  actions.forEach((action) => {
    if (actionKeys.has(action)) {
      permissions[moduleKey][action] = true;
    }
  });
};

const grantAll = (permissions, moduleKey) => {
  grant(permissions, moduleKey, PERMISSION_ACTIONS);
};

const lockAdminOnlyPermissions = (roleKey, permissions) => {
  if (!isSuperAdminLikeRole(roleKey)) {
    PIS_ADMIN_ONLY_ACTIONS.forEach((action) => {
      if (permissions?.pis && action in permissions.pis) {
        permissions.pis[action] = false;
      }
    });
  }

  if (isAdminLikeRole(roleKey)) return permissions;

  PRODUCT_TYPE_TEMPLATE_ADMIN_ONLY_ACTIONS.forEach((action) => {
    if (
      permissions?.product_type_templates &&
      action in permissions.product_type_templates
    ) {
      permissions.product_type_templates[action] = false;
    }
  });

  WORKFLOW_ADMIN_ONLY_ACTIONS.forEach((action) => {
    if (permissions?.workflow && action in permissions.workflow) {
      permissions.workflow[action] = false;
    }
  });

  PERMISSION_ADMIN_ONLY_ACTIONS.forEach((action) => {
    if (permissions?.permissions && action in permissions.permissions) {
      permissions.permissions[action] = false;
    }
  });

  return permissions;
};

const buildAdminPermissions = () => {
  const permissions = createEmptyPermissions();
  PERMISSION_MODULES.forEach((module) => grantAll(permissions, module.key));
  return permissions;
};

const buildManagerPermissions = () => {
  const permissions = buildAdminPermissions();
  return lockAdminOnlyPermissions("manager", permissions);
};

const buildDevPermissions = () => {
  const permissions = buildAdminPermissions();
  return lockAdminOnlyPermissions("dev", permissions);
};

const buildSuperAdminPermissions = () => buildAdminPermissions();

const buildProductManagerPermissions = () => buildManagerPermissions();

const buildInspectionManagerPermissions = () => buildManagerPermissions();

const buildUserPermissions = () => {
  const permissions = createEmptyPermissions();

  [
    "dashboard",
    "orders",
    "qc",
    "inspections",
    "items",
    "product_database",
    "product_type_templates",
    "workflow",
    "pis",
    "shipments",
    "containers",
    "samples",
    "reports",
    "calendar",
    "brands",
    "finishes",
    "images_documents",
  ].forEach((moduleKey) => grant(permissions, moduleKey, ["view"]));

  grant(permissions, "orders", ["export"]);
  grant(permissions, "qc", ["export"]);
  grant(permissions, "reports", ["export"]);
  grant(permissions, "pis", ["export"]);
  grant(permissions, "images_documents", ["upload"]);
  grant(permissions, "images_documents", ["export"]);

  return lockAdminOnlyPermissions("user", permissions);
};

const buildQcPermissions = () => {
  const permissions = createEmptyPermissions();

  [
    "dashboard",
    "orders",
    "qc",
    "inspections",
    "items",
    "pis",
    "product_type_templates",
    "workflow",
    "shipments",
    "containers",
    "samples",
    "reports",
    "brands",
    "finishes",
    "images_documents",
  ].forEach((moduleKey) => grant(permissions, moduleKey, ["view"]));

  grant(permissions, "qc", ["edit", "upload"]);
  grant(permissions, "inspections", ["create", "edit"]);
  grant(permissions, "images_documents", ["upload"]);
  grant(permissions, "reports", ["export"]);

  return lockAdminOnlyPermissions("qc", permissions);
};

const DEFAULT_PERMISSION_BUILDERS = Object.freeze({
  admin: buildAdminPermissions,
  super_admin: buildSuperAdminPermissions,
  manager: buildManagerPermissions,
  product_manager: buildProductManagerPermissions,
  inspection_manager: buildInspectionManagerPermissions,
  user: buildUserPermissions,
  qc: buildQcPermissions,
  dev: buildDevPermissions,
});

const normalizeRoleKey = (role) => {
  const roleKey = normalizeUserRoleKey(role);
  return ROLE_KEYS.includes(roleKey) ? roleKey : "user";
};

const getDefaultPermissionsForRole = (role) => {
  const roleKey = normalizeRoleKey(role);
  const builder = DEFAULT_PERMISSION_BUILDERS[roleKey] || buildUserPermissions;
  return builder();
};

const normalizePermissionMatrix = (permissions = {}) => {
  const normalized = createEmptyPermissions();

  PERMISSION_MODULES.forEach((module) => {
    const modulePermissions = permissions?.[module.key] || {};
    PERMISSION_ACTIONS.forEach((action) => {
      normalized[module.key][action] = Boolean(modulePermissions?.[action]);
    });
  });

  return normalized;
};

const mergePermissionsWithDefaults = (role, permissions = {}) => {
  const roleKey = normalizeRoleKey(role);
  const merged = getDefaultPermissionsForRole(roleKey);
  const normalized = normalizePermissionMatrix(permissions);

  PERMISSION_MODULES.forEach((module) => {
    PERMISSION_ACTIONS.forEach((action) => {
      if (
        permissions?.[module.key]
        && Object.prototype.hasOwnProperty.call(permissions[module.key], action)
      ) {
        merged[module.key][action] = normalized[module.key][action];
      }
    });
  });

  return lockAdminOnlyPermissions(roleKey, merged);
};

const sanitizePermissionsForRole = (role, permissions = {}) => {
  const roleKey = normalizeRoleKey(role);
  const sanitized = createEmptyPermissions();

  Object.entries(permissions || {}).forEach(([moduleKey, modulePermissions]) => {
    if (!moduleKeys.has(moduleKey) || !modulePermissions || typeof modulePermissions !== "object") {
      return;
    }

    Object.entries(modulePermissions).forEach(([action, value]) => {
      if (actionKeys.has(action)) {
        sanitized[moduleKey][action] = Boolean(value);
      }
    });
  });

  return lockAdminOnlyPermissions(roleKey, sanitized);
};

const isPermissionCellLocked = (role, moduleKey, action) => {
  const roleKey = normalizeRoleKey(role);
  if (isSuperAdminLikeRole(roleKey)) return false;
  if (moduleKey === "pis" && PIS_ADMIN_ONLY_ACTIONS.includes(action)) return true;
  if (isAdminLikeRole(roleKey)) return false;
  if (moduleKey === "permissions") return true;
  if (
    moduleKey === "product_type_templates" &&
    PRODUCT_TYPE_TEMPLATE_ADMIN_ONLY_ACTIONS.includes(action)
  ) {
    return true;
  }
  if (moduleKey === "workflow" && WORKFLOW_ADMIN_ONLY_ACTIONS.includes(action)) {
    return true;
  }
  return false;
};

const buildPermissionMeta = () => ({
  roles: ROLE_KEYS,
  modules: PERMISSION_MODULES,
  actions: PERMISSION_ACTIONS,
  locked: {
    pis: {
      roles: ROLE_KEYS.filter((role) => !isSuperAdminLikeRole(role)),
      actions: PIS_ADMIN_ONLY_ACTIONS,
      message: "PIS data edit rights are super-admin-only and cannot be assigned to other roles.",
    },
    product_type_templates: {
      roles: ROLE_KEYS.filter((role) => !isAdminLikeRole(role)),
      actions: PRODUCT_TYPE_TEMPLATE_ADMIN_ONLY_ACTIONS,
      message: "Product type template create/update/archive rights are admin-only.",
    },
    workflow: {
      roles: ROLE_KEYS.filter((role) => !isAdminLikeRole(role)),
      actions: WORKFLOW_ADMIN_ONLY_ACTIONS,
      message: "Workflow task approve and delete rights are admin-only.",
    },
    permissions: {
      roles: ROLE_KEYS.filter((role) => !isAdminLikeRole(role)),
      actions: PERMISSION_ADMIN_ONLY_ACTIONS,
      message: "Permission-management rights are admin-only.",
    },
  },
});

const hasPermission = (permissions, moduleKey, action) => {
  if (!moduleKeys.has(moduleKey) || !actionKeys.has(action)) return false;
  return Boolean(permissions?.[moduleKey]?.[action]);
};

const buildAuditActor = (user = {}) => ({
  user: user?._id || user?.id || null,
  name: String(user?.name || user?.email || user?.username || user?.role || "Unknown").trim(),
});

module.exports = {
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  ROLE_KEYS,
  PIS_ADMIN_ONLY_ACTIONS,
  PRODUCT_TYPE_TEMPLATE_ADMIN_ONLY_ACTIONS,
  WORKFLOW_ADMIN_ONLY_ACTIONS,
  clonePermissions: clone,
  buildPermissionMeta,
  buildAuditActor,
  getDefaultPermissionsForRole,
  hasPermission,
  isPermissionCellLocked,
  lockAdminOnlyPermissions,
  mergePermissionsWithDefaults,
  normalizePermissionMatrix,
  normalizeRoleKey,
  sanitizePermissionsForRole,
};

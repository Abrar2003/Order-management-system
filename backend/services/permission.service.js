const RolePermission = require("../models/rolePermission.model");
const {
  ROLE_KEYS,
  buildAuditActor,
  buildPermissionMeta,
  clonePermissions,
  getDefaultPermissionsForRole,
  hasPermission,
  mergePermissionsWithDefaults,
  normalizeRoleKey,
  sanitizePermissionsForRole,
} = require("../helpers/permissions");

const HISTORY_LIMIT = 25;
const ADMIN_PERMISSION_SOURCE_ROLE = "admin";
const ADMIN_PERMISSION_MIRROR_ROLES = new Set([
  "manager",
  "product_manager",
  "inspection_manager",
]);

const serializeRolePermission = (doc, role, permissionOverride = null) => {
  const roleKey = normalizeRoleKey(doc?.role || role);
  const rawPermissions = doc?.permissions || {};
  const permissions = permissionOverride
    ? clonePermissions(permissionOverride)
    : mergePermissionsWithDefaults(roleKey, rawPermissions);

  return {
    role: roleKey,
    permissions,
    updated_by: doc?.updated_by || null,
    updated_at: doc?.updated_at || doc?.updatedAt || null,
  };
};

const getRolePermissionDoc = async (role) => {
  const roleKey = normalizeRoleKey(role);
  return RolePermission.findOne({ role: roleKey }).lean();
};

const getAdminPermissionSource = async () => {
  const adminDoc = await getRolePermissionDoc(ADMIN_PERMISSION_SOURCE_ROLE);
  return {
    doc: adminDoc,
    permissions: mergePermissionsWithDefaults(
      ADMIN_PERMISSION_SOURCE_ROLE,
      adminDoc?.permissions || {},
    ),
  };
};

const getRolePermissions = async (role) => {
  const roleKey = normalizeRoleKey(role);
  if (ADMIN_PERMISSION_MIRROR_ROLES.has(roleKey)) {
    const adminPermissionSource = await getAdminPermissionSource();
    return serializeRolePermission(
      { ...(adminPermissionSource.doc || {}), role: roleKey },
      roleKey,
      adminPermissionSource.permissions,
    );
  }
  const doc = await getRolePermissionDoc(roleKey);
  return serializeRolePermission(doc, roleKey);
};

const getAllRolePermissions = async () => {
  const docs = await RolePermission.find({ role: { $in: ROLE_KEYS } }).lean();
  const docByRole = new Map(docs.map((doc) => [normalizeRoleKey(doc.role), doc]));
  const adminPermissions = mergePermissionsWithDefaults(
    ADMIN_PERMISSION_SOURCE_ROLE,
    docByRole.get(ADMIN_PERMISSION_SOURCE_ROLE)?.permissions || {},
  );

  return {
    meta: buildPermissionMeta(),
    roles: ROLE_KEYS.map((role) =>
      serializeRolePermission(
        ADMIN_PERMISSION_MIRROR_ROLES.has(role)
          ? { ...(docByRole.get(ADMIN_PERMISSION_SOURCE_ROLE) || {}), role }
          : docByRole.get(role),
        role,
        ADMIN_PERMISSION_MIRROR_ROLES.has(role) ? adminPermissions : null,
      ),
    ),
  };
};

const getEffectivePermissionsForUser = async (user = {}) => {
  const roleKey = normalizeRoleKey(user?.role);
  const rolePermissions = await getRolePermissions(roleKey);

  return {
    role: roleKey,
    permissions: rolePermissions.permissions,
    meta: buildPermissionMeta(),
  };
};

const userHasPermission = async (user = {}, moduleKey, action) => {
  const effective = await getEffectivePermissionsForUser(user);
  return hasPermission(effective.permissions, moduleKey, action);
};

const saveRolePermissions = async ({
  role,
  permissions,
  actor,
  auditAction = "update",
}) => {
  const roleKey = normalizeRoleKey(role);
  const adminPermissionSource = ADMIN_PERMISSION_MIRROR_ROLES.has(roleKey)
    ? await getAdminPermissionSource()
    : null;
  const effectiveRequestedPermissions = ADMIN_PERMISSION_MIRROR_ROLES.has(roleKey)
    ? adminPermissionSource.permissions
    : permissions;
  const previousDoc = await RolePermission.findOne({ role: roleKey }).lean();
  const previousPermissions = previousDoc
    ? mergePermissionsWithDefaults(roleKey, previousDoc.permissions)
    : getDefaultPermissionsForRole(roleKey);
  const nextPermissions = sanitizePermissionsForRole(
    roleKey,
    effectiveRequestedPermissions,
  );
  const auditActor = buildAuditActor(actor);
  const historyEntry = {
    action: auditAction,
    previous_permissions: clonePermissions(previousPermissions),
    next_permissions: clonePermissions(nextPermissions),
    actor: auditActor,
    timestamp: new Date(),
  };

  const updated = await RolePermission.findOneAndUpdate(
    { role: roleKey },
    {
      $set: {
        role: roleKey,
        permissions: nextPermissions,
        updated_by: auditActor,
        updated_at: new Date(),
      },
      $push: {
        history: {
          $each: [historyEntry],
          $slice: -HISTORY_LIMIT,
        },
      },
    },
    { new: true, upsert: true },
  ).lean();

  return getRolePermissions(updated?.role || roleKey);
};

const resetRolePermissions = async ({ role, actor }) => {
  const roleKey = normalizeRoleKey(role);
  return saveRolePermissions({
    role: roleKey,
    permissions: getDefaultPermissionsForRole(roleKey),
    actor,
    auditAction: "reset_to_default",
  });
};

module.exports = {
  getAllRolePermissions,
  getEffectivePermissionsForUser,
  getRolePermissions,
  resetRolePermissions,
  saveRolePermissions,
  userHasPermission,
};

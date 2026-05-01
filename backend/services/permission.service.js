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

const serializeRolePermission = (doc, role) => {
  const roleKey = normalizeRoleKey(doc?.role || role);
  const rawPermissions = doc?.permissions || {};
  const permissions = mergePermissionsWithDefaults(roleKey, rawPermissions);

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

const getRolePermissions = async (role) => {
  const roleKey = normalizeRoleKey(role);
  const doc = await getRolePermissionDoc(roleKey);
  return serializeRolePermission(doc, roleKey);
};

const getAllRolePermissions = async () => {
  const docs = await RolePermission.find({ role: { $in: ROLE_KEYS } }).lean();
  const docByRole = new Map(docs.map((doc) => [normalizeRoleKey(doc.role), doc]));

  return {
    meta: buildPermissionMeta(),
    roles: ROLE_KEYS.map((role) => serializeRolePermission(docByRole.get(role), role)),
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
  const previousDoc = await RolePermission.findOne({ role: roleKey }).lean();
  const previousPermissions = previousDoc
    ? mergePermissionsWithDefaults(roleKey, previousDoc.permissions)
    : getDefaultPermissionsForRole(roleKey);
  const nextPermissions = sanitizePermissionsForRole(roleKey, permissions);
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

  return serializeRolePermission(updated, roleKey);
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

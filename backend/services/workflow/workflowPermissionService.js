const { isAdminLikeRole, isManagerLikeRole } = require("../../helpers/userRole");
const { normalizeRoleKey } = require("../../helpers/permissions");

const normalizeId = (value) =>
  String(value?._id || value?.id || value || "").trim();

const isAdmin = (user = {}) =>
  isAdminLikeRole(normalizeRoleKey(user?.role));

const isManagerOrAdmin = (user = {}) =>
  isManagerLikeRole(normalizeRoleKey(user?.role));

const isPrivilegedWorkflowReader = (user = {}) =>
  [
    "dev",
  ].includes(normalizeRoleKey(user?.role)) || isManagerLikeRole(normalizeRoleKey(user?.role));

const isTaskAssignedToUser = (task = {}, userId) => {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return false;
  return (Array.isArray(task?.assigned_to) ? task.assigned_to : []).some(
    (entry) => normalizeId(entry?.user || entry) === normalizedUserId,
  );
};

const isTaskAssignedByUser = (task = {}, userId) => {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return false;
  return normalizeId(task?.assigned_by?.user) === normalizedUserId;
};

const isTaskCreatedByUser = (task = {}, userId) => {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return false;
  return normalizeId(task?.created_by?.user) === normalizedUserId;
};

const canReadWorkflowTask = (user = {}, task = {}) =>
  isAdmin(user) ||
  isTaskAssignedToUser(task, user?._id || user?.id) ||
  isTaskAssignedByUser(task, user?._id || user?.id) ||
  isTaskCreatedByUser(task, user?._id || user?.id);

const canCompleteWorkflowTask = (user = {}, task = {}) =>
  isTaskAssignedToUser(task, user?._id || user?.id);

const canApproveWorkflowTask = (user = {}, task = {}) =>
  isTaskAssignedByUser(task, user?._id || user?.id);

const canUploadWorkflowTask = (user = {}, task = {}) =>
  isTaskAssignedToUser(task, user?._id || user?.id) ||
  isTaskCreatedByUser(task, user?._id || user?.id);

module.exports = {
  isAdmin,
  canApproveWorkflowTask,
  canCompleteWorkflowTask,
  canReadWorkflowTask,
  canUploadWorkflowTask,
  isManagerOrAdmin,
  isPrivilegedWorkflowReader,
  isTaskAssignedToUser,
};

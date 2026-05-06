const { isAdminLikeRole, isManagerLikeRole } = require("../../helpers/userRole");
const { normalizeRoleKey } = require("../../helpers/permissions");

const normalizeId = (value) => String(value || "").trim();

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

const canReadWorkflowTask = (user = {}, task = {}) =>
  isAdmin(user) || isTaskAssignedToUser(task, user?._id);

const canCompleteWorkflowTask = (user = {}, task = {}) =>
  isTaskAssignedToUser(task, user?._id);

const canApproveWorkflowTask = (user = {}, task = {}) =>
  isAdmin(user) && !isTaskAssignedToUser(task, user?._id);

const canUploadWorkflowTask = (user = {}, task = {}) =>
  isAdmin(user) || isTaskAssignedToUser(task, user?._id);

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

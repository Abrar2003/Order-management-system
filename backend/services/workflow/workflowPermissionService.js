const { isManagerLikeRole } = require("../../helpers/userRole");
const { normalizeRoleKey } = require("../../helpers/permissions");

const normalizeId = (value) =>
  String(value?._id || value?.id || value || "").trim();

const isAdmin = (user = {}) =>
  ["admin", "super_admin"].includes(normalizeRoleKey(user?.role));

const isManagerOrAdmin = (user = {}) =>
  isManagerLikeRole(normalizeRoleKey(user?.role));

const isPrivilegedWorkflowReader = (user = {}) =>
  isAdmin(user);

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

const isTaskUploadAssignedToUser = (task = {}, userId) => {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId || task?.upload_required === false) return false;
  return (Array.isArray(task?.upload_assignees) ? task.upload_assignees : []).some(
    (entry) => normalizeId(entry?.user || entry) === normalizedUserId,
  );
};

const hasExplicitUploadAssignees = (task = {}) =>
  (Array.isArray(task?.upload_assignees) ? task.upload_assignees : []).length > 0;

const canReadWorkflowTask = (user = {}, task = {}) =>
  isAdmin(user) ||
  isTaskAssignedToUser(task, user?._id || user?.id) ||
  (
    String(task?.status || "").trim() === "approved" &&
    isTaskUploadAssignedToUser(task, user?._id || user?.id)
  );

const canCompleteWorkflowTask = (user = {}, task = {}) =>
  isTaskAssignedToUser(task, user?._id || user?.id);

const canApproveWorkflowTask = (user = {}, task = {}) =>
  isTaskAssignedByUser(task, user?._id || user?.id);

const canUploadWorkflowTask = (user = {}, task = {}) =>
  task?.upload_required !== false &&
  (
    hasExplicitUploadAssignees(task)
      ? isTaskUploadAssignedToUser(task, user?._id || user?.id)
      : (
          isTaskAssignedToUser(task, user?._id || user?.id) ||
          isTaskCreatedByUser(task, user?._id || user?.id)
        )
  );

module.exports = {
  isAdmin,
  canApproveWorkflowTask,
  canCompleteWorkflowTask,
  canReadWorkflowTask,
  canUploadWorkflowTask,
  isManagerOrAdmin,
  isPrivilegedWorkflowReader,
  isTaskUploadAssignedToUser,
  isTaskAssignedToUser,
};

const { normalizeRoleKey } = require("../../helpers/permissions");

const normalizeId = (value) => String(value || "").trim();

const isAdmin = (user = {}) =>
  normalizeRoleKey(user?.role) === "admin";

const isManagerOrAdmin = (user = {}) =>
  isAdmin(user) || normalizeRoleKey(user?.role) === "manager";

const isPrivilegedWorkflowReader = (user = {}) =>
  ["admin", "manager", "dev"].includes(normalizeRoleKey(user?.role));

const isTaskAssignedToUser = (task = {}, userId) => {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return false;
  return (Array.isArray(task?.assigned_to) ? task.assigned_to : []).some(
    (entry) => normalizeId(entry?.user || entry) === normalizedUserId,
  );
};

const canReadWorkflowTask = (user = {}, task = {}) =>
  isPrivilegedWorkflowReader(user) || isTaskAssignedToUser(task, user?._id);

const canStartWorkflowTask = (user = {}, task = {}) =>
  isTaskAssignedToUser(task, user?._id);

const canSubmitWorkflowTask = (user = {}, task = {}) =>
  isTaskAssignedToUser(task, user?._id);

const canApproveWorkflowTask = (user = {}, task = {}) =>
  isManagerOrAdmin(user) && !isTaskAssignedToUser(task, user?._id);

module.exports = {
  isAdmin,
  canApproveWorkflowTask,
  canReadWorkflowTask,
  canStartWorkflowTask,
  canSubmitWorkflowTask,
  isManagerOrAdmin,
  isPrivilegedWorkflowReader,
  isTaskAssignedToUser,
};

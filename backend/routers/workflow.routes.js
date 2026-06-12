const express = require("express");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const {
  securityLog,
} = require("../middlewares/securityActivityLogger");
const {
  bulkPatchWorkflowBatchTasks,
  cancelBatch,
  createBatchFromFolderManifest,
  getWorkflowBatch,
  getWorkflowBatches,
  patchWorkflowBatch,
  removeBatch,
} = require("../controllers/workflow/batch.controller");
const {
  approveTask,
  approveHoldTask,
  assignTask,
  completeTask,
  createTask,
  getWorkflowDashboard,
  getWorkflowAssignableUsers,
  getWorkflowTask,
  getWorkflowTasks,
  patchTask,
  patchTaskStatus,
  postTaskComment,
  removeTask,
  reviewTask,
  reworkTask,
  rejectHoldTask,
  requestHoldTask,
  resumeTask,
  startTask,
  submitTask,
  uploadTask,
} = require("../controllers/workflow/task.controller");
const {
  createTaskType,
  getWorkflowTaskTypes,
  patchTaskType,
} = require("../controllers/workflow/taskType.controller");
const {
  createDepartment,
  getWorkflowDepartments,
  patchDepartment,
} = require("../controllers/workflow/department.controller");

const router = express.Router();
const WORKFLOW_MANAGER_ROLES = [
  "admin",
  "super admin",
  "manager",
  "product manager",
  "inspection manager",
];
const WORKFLOW_ADMIN_ROLES = ["admin", "super admin"];

router.get(
  "/dashboard",
  auth,
  requirePermission("workflow", "view"),
  getWorkflowDashboard,
);

router.post(
  "/batches/from-folder-manifest",
  auth,
  authorize(...WORKFLOW_ADMIN_ROLES),
  requirePermission("workflow", "create"),
  createBatchFromFolderManifest,
);

router.get(
  "/batches",
  auth,
  requirePermission("workflow", "view"),
  getWorkflowBatches,
);

router.get(
  "/batches/:id",
  auth,
  requirePermission("workflow", "view"),
  getWorkflowBatch,
);

router.patch(
  "/batches/:id",
  auth,
  authorize(...WORKFLOW_MANAGER_ROLES),
  requirePermission("workflow", "edit"),
  patchWorkflowBatch,
);

router.patch(
  "/batches/:id/tasks/bulk",
  auth,
  authorize(...WORKFLOW_MANAGER_ROLES),
  requirePermission("workflow", "edit"),
  bulkPatchWorkflowBatchTasks,
);

router.patch(
  "/batches/:id/cancel",
  auth,
  authorize(...WORKFLOW_MANAGER_ROLES),
  requirePermission("workflow", "edit"),
  cancelBatch,
);

router.delete(
  "/batches/:id",
  auth,
  authorize(...WORKFLOW_ADMIN_ROLES),
  requirePermission("workflow", "delete"),
  removeBatch,
);

router.post(
  "/tasks",
  auth,
  createTask,
);

router.get(
  "/users",
  auth,
  requirePermission("workflow", "view"),
  getWorkflowAssignableUsers,
);

router.get(
  "/tasks",
  auth,
  requirePermission("workflow", "view"),
  getWorkflowTasks,
);

router.get(
  "/tasks/:id",
  auth,
  requirePermission("workflow", "view"),
  getWorkflowTask,
);

router.patch(
  "/tasks/:id",
  auth,
  requirePermission("workflow", "view"),
  securityLog("update", "workflow_task"),
  patchTask,
);

router.patch(
  "/tasks/:id/assign",
  auth,
  requirePermission("workflow", "view"),
  securityLog("assign", "workflow_task"),
  assignTask,
);

router.patch(
  "/tasks/:id/start",
  auth,
  requirePermission("workflow", "view"),
  securityLog("start", "workflow_task"),
  startTask,
);

router.patch(
  "/tasks/:id/submit",
  auth,
  requirePermission("workflow", "view"),
  securityLog("submit", "workflow_task"),
  submitTask,
);

router.patch(
  "/tasks/:id/complete",
  auth,
  requirePermission("workflow", "view"),
  securityLog("complete", "workflow_task"),
  completeTask,
);

router.patch(
  "/tasks/:id/review",
  auth,
  authorize(...WORKFLOW_MANAGER_ROLES),
  requirePermission("workflow", "edit"),
  securityLog("review", "workflow_task"),
  reviewTask,
);

router.patch(
  "/tasks/:id/approve",
  auth,
  requirePermission("workflow", "view"),
  securityLog("approve", "workflow_task"),
  approveTask,
);

router.patch(
  "/tasks/:id/upload",
  auth,
  requirePermission("workflow", "view"),
  securityLog("upload", "workflow_task"),
  uploadTask,
);

router.patch(
  "/tasks/:id/rework",
  auth,
  requirePermission("workflow", "view"),
  securityLog("rework", "workflow_task"),
  reworkTask,
);

router.patch(
  "/tasks/:id/hold",
  auth,
  requirePermission("workflow", "view"),
  securityLog("hold", "workflow_task"),
  requestHoldTask,
);

router.patch(
  "/tasks/:id/hold/approve",
  auth,
  requirePermission("workflow", "view"),
  securityLog("approve_hold", "workflow_task"),
  approveHoldTask,
);

router.patch(
  "/tasks/:id/hold/reject",
  auth,
  requirePermission("workflow", "view"),
  securityLog("reject_hold", "workflow_task"),
  rejectHoldTask,
);

router.patch(
  "/tasks/:id/resume",
  auth,
  requirePermission("workflow", "view"),
  securityLog("resume", "workflow_task"),
  resumeTask,
);

router.patch(
  "/tasks/:id/status",
  auth,
  requirePermission("workflow", "view"),
  securityLog("update_status", "workflow_task"),
  patchTaskStatus,
);

router.post(
  "/tasks/:id/comments",
  auth,
  requirePermission("workflow", "view"),
  postTaskComment,
);

router.delete(
  "/tasks/:id",
  auth,
  requirePermission("workflow", "view"),
  securityLog("delete", "workflow_task"),
  removeTask,
);

router.get(
  "/task-types",
  auth,
  requirePermission("workflow", "view"),
  getWorkflowTaskTypes,
);

router.post(
  "/task-types",
  auth,
  authorize(...WORKFLOW_MANAGER_ROLES),
  requirePermission("workflow", "manage"),
  createTaskType,
);

router.patch(
  "/task-types/:id",
  auth,
  authorize(...WORKFLOW_MANAGER_ROLES),
  requirePermission("workflow", "manage"),
  patchTaskType,
);

router.get(
  "/departments",
  auth,
  requirePermission("workflow", "view"),
  getWorkflowDepartments,
);

router.post(
  "/departments",
  auth,
  authorize(...WORKFLOW_MANAGER_ROLES),
  requirePermission("workflow", "manage"),
  createDepartment,
);

router.patch(
  "/departments/:id",
  auth,
  authorize(...WORKFLOW_MANAGER_ROLES),
  requirePermission("workflow", "manage"),
  patchDepartment,
);

module.exports = router;

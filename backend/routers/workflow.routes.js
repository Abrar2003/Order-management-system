const express = require("express");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const {
  cancelBatch,
  createBatchFromFolderManifest,
  getWorkflowBatch,
  getWorkflowBatches,
  patchWorkflowBatch,
  removeBatch,
} = require("../controllers/workflow/batch.controller");
const {
  approveTask,
  assignTask,
  createTask,
  getWorkflowDashboard,
  getWorkflowTask,
  getWorkflowTasks,
  patchTaskStatus,
  postTaskComment,
  removeTask,
  reviewTask,
  reworkTask,
  startTask,
  submitTask,
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
  authorize(...WORKFLOW_MANAGER_ROLES),
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
  authorize(...WORKFLOW_MANAGER_ROLES),
  requirePermission("workflow", "create"),
  createTask,
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
  "/tasks/:id/assign",
  auth,
  authorize(...WORKFLOW_MANAGER_ROLES),
  requirePermission("workflow", "assign"),
  assignTask,
);

router.patch(
  "/tasks/:id/start",
  auth,
  requirePermission("workflow", "view"),
  startTask,
);

router.patch(
  "/tasks/:id/submit",
  auth,
  requirePermission("workflow", "view"),
  submitTask,
);

router.patch(
  "/tasks/:id/review",
  auth,
  authorize(...WORKFLOW_MANAGER_ROLES),
  requirePermission("workflow", "edit"),
  reviewTask,
);

router.patch(
  "/tasks/:id/approve",
  auth,
  authorize(...WORKFLOW_ADMIN_ROLES),
  requirePermission("workflow", "approve"),
  approveTask,
);

router.patch(
  "/tasks/:id/rework",
  auth,
  authorize(...WORKFLOW_MANAGER_ROLES),
  requirePermission("workflow", "edit"),
  reworkTask,
);

router.patch(
  "/tasks/:id/status",
  auth,
  authorize(...WORKFLOW_MANAGER_ROLES),
  requirePermission("workflow", "edit"),
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
  authorize(...WORKFLOW_ADMIN_ROLES),
  requirePermission("workflow", "delete"),
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

const express = require("express");

const auth = require("../middlewares/auth.middleware");
const {
  requirePermission,
  requirePermissionOrRoles,
} = require("../middlewares/permission.middleware");
const { complaintFilesUpload } = require("../config/multer.config");
const complaintController = require("../controllers/complaint.controller");

const router = express.Router();

const MANAGER_ROLE_KEYS = [
  "admin",
  "super_admin",
  "manager",
  "product_manager",
  "inspection_manager",
];

router.get(
  "/",
  auth,
  requirePermissionOrRoles("complaints", "view", MANAGER_ROLE_KEYS),
  complaintController.getComplaints,
);

router.post(
  "/",
  auth,
  requirePermissionOrRoles("complaints", "create", MANAGER_ROLE_KEYS),
  complaintFilesUpload("files"),
  complaintController.createComplaint,
);

router.get(
  "/:id",
  auth,
  requirePermissionOrRoles("complaints", "view", MANAGER_ROLE_KEYS),
  complaintController.getComplaintById,
);

router.patch(
  "/:id/status",
  auth,
  requirePermissionOrRoles("complaints", "edit", MANAGER_ROLE_KEYS),
  complaintController.updateComplaintStatus,
);

router.post(
  "/:id/comments",
  auth,
  requirePermissionOrRoles("complaints", "edit", MANAGER_ROLE_KEYS),
  complaintController.addComplaintComment,
);

router.post(
  "/:id/files",
  auth,
  requirePermissionOrRoles("complaints", "upload", MANAGER_ROLE_KEYS),
  complaintFilesUpload("files"),
  complaintController.addComplaintFiles,
);

router.patch(
  "/:id/archive",
  auth,
  requirePermission("complaints", "delete"),
  complaintController.archiveComplaint,
);

router.patch(
  "/:id/unarchive",
  auth,
  requirePermission("complaints", "delete"),
  complaintController.unarchiveComplaint,
);

module.exports = router;

const express = require("express");
const auth = require("../middlewares/auth.middleware");
const {
  requirePermission,
  requirePermissionOrRoles,
} = require("../middlewares/permission.middleware");
const { sampleFilesUpload } = require("../config/multer.config");
const {
  getSamples,
  getSampleById,
  getSampleCadArtists,
  createSample,
  updateSample,
  updateSampleStatus,
  addSampleTimeline,
  addSampleFiles,
  updateSampleVendor,
  archiveSample,
  unarchiveSample,
  finalizeSampleShipment,
  getShippedSamples,
} = require("../controllers/sample.controller");

const router = express.Router();
const SAMPLE_WORKFLOW_ROLE_KEYS = [
  "admin",
  "super_admin",
  "inspection_manager",
  "product_manager",
];

router.get(
  "/",
  auth,
  requirePermission("samples", "view"),
  getSamples,
);

router.get(
  "/shipped",
  auth,
  requirePermission("samples", "view"),
  getShippedSamples,
);

router.get(
  "/cad-artists",
  auth,
  requirePermissionOrRoles("samples", "create", SAMPLE_WORKFLOW_ROLE_KEYS),
  getSampleCadArtists,
);

router.post(
  "/",
  auth,
  requirePermissionOrRoles("samples", "create", SAMPLE_WORKFLOW_ROLE_KEYS),
  sampleFilesUpload("files"),
  createSample,
);

router.get(
  "/:id",
  auth,
  requirePermission("samples", "view"),
  getSampleById,
);

router.patch(
  "/:id",
  auth,
  requirePermissionOrRoles("samples", "edit", SAMPLE_WORKFLOW_ROLE_KEYS),
  updateSample,
);

router.patch(
  "/:id/status",
  auth,
  requirePermissionOrRoles("samples", "edit", SAMPLE_WORKFLOW_ROLE_KEYS),
  updateSampleStatus,
);

router.post(
  "/:id/timeline",
  auth,
  requirePermissionOrRoles("samples", "edit", SAMPLE_WORKFLOW_ROLE_KEYS),
  addSampleTimeline,
);

router.post(
  "/:id/files",
  auth,
  requirePermissionOrRoles("samples", "upload", SAMPLE_WORKFLOW_ROLE_KEYS),
  sampleFilesUpload("files"),
  addSampleFiles,
);

router.patch(
  "/:id/vendors/:vendorEntryId",
  auth,
  requirePermissionOrRoles("samples", "edit", SAMPLE_WORKFLOW_ROLE_KEYS),
  sampleFilesUpload("files"),
  updateSampleVendor,
);

router.patch(
  "/:id/archive",
  auth,
  requirePermissionOrRoles("samples", "delete", SAMPLE_WORKFLOW_ROLE_KEYS),
  archiveSample,
);

router.patch(
  "/:id/unarchive",
  auth,
  requirePermissionOrRoles("samples", "delete", SAMPLE_WORKFLOW_ROLE_KEYS),
  unarchiveSample,
);

router.patch(
  "/:id/finalize-shipment",
  auth,
  requirePermissionOrRoles("samples", "edit", SAMPLE_WORKFLOW_ROLE_KEYS),
  finalizeSampleShipment,
);

module.exports = router;

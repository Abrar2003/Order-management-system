const express = require("express");
const auth = require("../middlewares/auth.middleware");
const {
  requirePermission,
  requirePermissionOrRoles,
} = require("../middlewares/permission.middleware");
const {
  getSampleWorkflows,
  createSampleWorkflow,
} = require("../controllers/sampleWorkflow.controller");

const router = express.Router();
const SAMPLE_MUTATION_ROLE_KEYS = [
  "admin",
  "super_admin",
  "inspection_manager",
  "product_manager",
];

router.get(
  "/",
  auth,
  requirePermission("samples", "view"),
  getSampleWorkflows,
);

router.post(
  "/",
  auth,
  requirePermissionOrRoles("samples", "create", SAMPLE_MUTATION_ROLE_KEYS),
  createSampleWorkflow,
);

module.exports = router;

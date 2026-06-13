const express = require("express");
const auth = require("../middlewares/auth.middleware");
const {
  requirePermission,
  requirePermissionOrRoles,
} = require("../middlewares/permission.middleware");
const {
  getSamples,
  createSample,
  updateSample,
  finalizeSampleShipment,
  getShippedSamples,
} = require("../controllers/sample.controller");

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
  getSamples,
);

router.get(
  "/shipped",
  auth,
  requirePermission("samples", "view"),
  getShippedSamples,
);

router.post(
  "/",
  auth,
  requirePermissionOrRoles("samples", "create", SAMPLE_MUTATION_ROLE_KEYS),
  createSample,
);

router.patch(
  "/:id",
  auth,
  requirePermissionOrRoles("samples", "edit", SAMPLE_MUTATION_ROLE_KEYS),
  updateSample,
);

router.patch(
  "/:id/finalize-shipment",
  auth,
  requirePermissionOrRoles("samples", "edit", SAMPLE_MUTATION_ROLE_KEYS),
  finalizeSampleShipment,
);

module.exports = router;

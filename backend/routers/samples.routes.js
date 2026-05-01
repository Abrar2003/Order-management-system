const express = require("express");
const auth = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const {
  getSamples,
  createSample,
  updateSample,
  finalizeSampleShipment,
  getShippedSamples,
} = require("../controllers/sample.controller");

const router = express.Router();

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
  requirePermission("samples", "create"),
  createSample,
);

router.patch(
  "/:id",
  auth,
  requirePermission("samples", "edit"),
  updateSample,
);

router.patch(
  "/:id/finalize-shipment",
  auth,
  requirePermission("samples", "edit"),
  finalizeSampleShipment,
);

module.exports = router;

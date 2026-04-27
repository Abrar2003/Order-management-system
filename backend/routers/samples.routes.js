const express = require("express");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
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
  authorize("admin", "manager", "QC", "dev", "user"),
  getSamples,
);

router.get(
  "/shipped",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  getShippedSamples,
);

router.post(
  "/",
  auth,
  authorize("admin", "manager", "dev"),
  createSample,
);

router.patch(
  "/:id",
  auth,
  authorize("admin"),
  updateSample,
);

router.patch(
  "/:id/finalize-shipment",
  auth,
  authorize("admin", "manager", "dev"),
  finalizeSampleShipment,
);

module.exports = router;

const express = require("express");

const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const reportsController = require("../controllers/reports.controller");

const router = express.Router();

router.get(
  "/vendor-wise-qa/summary",
  auth,
  authorize("admin", "manager", "dev", "user"),
  reportsController.getVendorWiseQaSummary,
);

router.get(
  "/vendor-wise-qa/detailed",
  auth,
  authorize("admin", "manager", "dev", "user"),
  reportsController.getVendorWiseQaDetailed,
);

module.exports = router;

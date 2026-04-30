const express = require("express");

const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const { cacheRoute } = require("../middlewares/cache.middleware");
const { MEDIUM_CACHE_TTL } = require("../services/cache.service");
const reportsController = require("../controllers/reports.controller");

const router = express.Router();

router.get(
  "/vendor-wise-qa/summary",
  auth,
  authorize("admin", "manager", "dev", "user"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  reportsController.getVendorWiseQaSummary,
);

router.get(
  "/vendor-wise-qa/detailed",
  auth,
  authorize("admin", "manager", "dev", "user"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  reportsController.getVendorWiseQaDetailed,
);

router.get(
  "/qc-report-mismatch",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  reportsController.getQcReportMismatch,
);

module.exports = router;

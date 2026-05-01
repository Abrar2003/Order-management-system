const express = require("express");

const auth = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const { cacheRoute } = require("../middlewares/cache.middleware");
const { MEDIUM_CACHE_TTL } = require("../services/cache.service");
const reportsController = require("../controllers/reports.controller");

const router = express.Router();

router.get(
  "/vendor-wise-qa/summary",
  auth,
  requirePermission("reports", "view"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  reportsController.getVendorWiseQaSummary,
);

router.get(
  "/vendor-wise-qa/detailed",
  auth,
  requirePermission("reports", "view"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  reportsController.getVendorWiseQaDetailed,
);

router.get(
  "/qc-report-mismatch",
  auth,
  requirePermission("reports", "view"),
  reportsController.getQcReportMismatch,
);

module.exports = router;

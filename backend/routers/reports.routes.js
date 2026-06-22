const express = require("express");

const auth = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const { cacheRoute } = require("../middlewares/cache.middleware");
const { MEDIUM_CACHE_TTL } = require("../services/cache.service");
const {
  securityLog,
} = require("../middlewares/securityActivityLogger");
const reportsController = require("../controllers/reports.controller");
const { renderHtmlPdf } = require("../controllers/pdf.controller");

const router = express.Router();

router.post(
  "/pdf/render",
  auth,
  requirePermission("reports", "view"),
  securityLog("export_pdf", "report", {
    metadata: (req) => ({ report_key: req.body?.reportKey || "" }),
  }),
  renderHtmlPdf,
);

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

router.get(
  "/inspected-items/export",
  auth,
  requirePermission("reports", "view"),
  securityLog("export_excel", "inspected_items_report", {
    metadata: (req) => ({ filters: req.query || {} }),
  }),
  reportsController.exportInspectedItemsReport,
);

router.get(
  "/inspected-items",
  auth,
  requirePermission("reports", "view"),
  cacheRoute("reports_inspected_v2", MEDIUM_CACHE_TTL),
  reportsController.getInspectedItemsReport,
);

module.exports = router;

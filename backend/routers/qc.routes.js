const express = require("express");
const router = express.Router();

const upload = require("../config/multer.config");
const qcImageAnyUpload = upload.qcImageAnyUpload;
const qcImageSingleUpload = upload.qcImageSingleUpload;
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const {
  cacheRoute,
  invalidateCacheOnSuccess,
} = require("../middlewares/cache.middleware");
const {
  SHORT_CACHE_TTL,
  MEDIUM_CACHE_TTL,
} = require("../services/cache.service");
const {
  invalidateQcCaches,
} = require("../services/cacheInvalidation.service");
const qcController = require("../controllers/qc.controller");
const invalidateQcOnSuccess = invalidateCacheOnSuccess(invalidateQcCaches);

// GET all QC
router.get(
  "/list",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  cacheRoute("qc", SHORT_CACHE_TTL),
  qcController.getQCList
);

// Align QC (manager/admin)
router.post(
  "/align-qc",
  auth,
  authorize("admin", "manager"),
  invalidateQcOnSuccess,
  qcController.alignQC
);

// Update QC (Inspector or Admin)
router.patch(
  "/update-qc/:id",
  auth,
  authorize("QC", "admin", "manager"),
  invalidateQcOnSuccess,
  qcController.updateQC
);

router.patch(
  "/goods-not-ready/:id",
  auth,
  authorize("QC", "admin", "manager"),
  invalidateQcOnSuccess,
  qcController.markGoodsNotReady
);

router.patch(
  "/reject-all/:id",
  auth,
  authorize("QC", "admin", "manager"),
  qcImageSingleUpload("image"),
  invalidateQcOnSuccess,
  qcController.rejectAllQc,
);

router.post(
  "/:id/transfer-request",
  auth,
  authorize("admin", "manager"),
  invalidateQcOnSuccess,
  qcController.transferQcRequest,
);

router.post(
  "/:id/images",
  auth,
  authorize("QC", "admin", "manager"),
  qcImageAnyUpload,
  invalidateQcOnSuccess,
  qcController.uploadQcImages,
);

router.delete(
  "/:id/images",
  auth,
  authorize("admin", "manager"),
  invalidateQcOnSuccess,
  qcController.deleteQcImages,
);

router.post(
  "/sync-item-details",
  auth,
  authorize("admin", "manager", "dev"),
  invalidateQcOnSuccess,
  qcController.syncQcDetailsFromItems,
);

router.post(
  "/sync-inspections",
  auth,
  authorize("admin", "manager", "dev"),
  invalidateQcOnSuccess,
  qcController.syncInspectionStatuses,
);

router.get(
  "/daily-report",
  auth,
  authorize("admin", "manager", "dev", "user"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  qcController.getDailyReport
);

router.get(
  "/reports/inspectors",
  auth,
  authorize("admin", "manager", "dev", "user"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  qcController.getInspectorReports,
);

router.get(
  "/reports/vendors",
  auth,
  authorize("admin", "manager", "dev", "user"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  qcController.getVendorReports,
);

router.get(
  "/reports/weekly-summary",
  auth,
  authorize("admin", "manager", "dev", "user"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  qcController.getWeeklyOrderSummary,
);

router.get(
  "/reports/daily-summary",
  auth,
  authorize("admin", "manager", "dev", "user"),
  cacheRoute("reports", MEDIUM_CACHE_TTL),
  qcController.getDailyOrderSummary,
);

router.get(
  "/export",
  auth,
  authorize("admin", "manager", "dev", "user"),
  qcController.exportQCList,
);

router.patch(
  "/:id/inspection-records",
  auth,
  authorize("admin", "manager"),
  invalidateQcOnSuccess,
  qcController.editInspectionRecords,
);

router.get(
  "/:id/inspection-record/:recordId/transfer-target",
  auth,
  authorize("admin", "manager"),
  cacheRoute("qc", SHORT_CACHE_TTL),
  qcController.lookupInspectionTransferTarget,
);

router.post(
  "/:id/inspection-record/:recordId/transfer",
  auth,
  authorize("admin", "manager"),
  invalidateQcOnSuccess,
  qcController.transferInspectionRecord,
);

router.delete(
  "/:id/inspection-record/:recordId",
  auth,
  authorize("admin"),
  invalidateQcOnSuccess,
  qcController.deleteInspectionRecord,
);

router.get(
  "/:id",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  cacheRoute("qc", SHORT_CACHE_TTL),
  qcController.getQCById
);

module.exports = router;

const express = require("express");
const router = express.Router();

const upload = require("../config/multer.config");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const qcController = require("../controllers/qc.controller");

// GET all QC
router.get(
  "/list",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  qcController.getQCList
);

// Align QC (manager/admin)
router.post(
  "/align-qc",
  auth,
  authorize("admin", "manager"),
  qcController.alignQC
);

// Update QC (Inspector or Admin)
router.patch(
  "/update-qc/:id",
  auth,
  authorize("QC", "admin", "manager"),
  qcController.updateQC
);

router.patch(
  "/goods-not-ready/:id",
  auth,
  authorize("QC", "admin", "manager"),
  qcController.markGoodsNotReady
);

router.post(
  "/:id/transfer-request",
  auth,
  authorize("admin", "manager"),
  qcController.transferQcRequest,
);

router.post(
  "/:id/images",
  auth,
  authorize("QC", "admin", "manager"),
  upload.any(),
  qcController.uploadQcImages,
);

router.delete(
  "/:id/images",
  auth,
  authorize("admin", "manager"),
  qcController.deleteQcImages,
);

router.post(
  "/sync-item-details",
  auth,
  authorize("admin", "manager", "dev"),
  qcController.syncQcDetailsFromItems,
);

router.post(
  "/sync-inspections",
  auth,
  authorize("admin", "manager", "dev"),
  qcController.syncInspectionStatuses,
);

router.get(
  "/daily-report",
  auth,
  authorize("admin", "manager", "dev", "user"),
  qcController.getDailyReport
);

router.get(
  "/reports/inspectors",
  auth,
  authorize("admin", "manager", "dev", "user"),
  qcController.getInspectorReports,
);

router.get(
  "/reports/vendors",
  auth,
  authorize("admin", "manager", "dev", "user"),
  qcController.getVendorReports,
);

router.get(
  "/reports/weekly-summary",
  auth,
  authorize("admin", "manager", "dev", "user"),
  qcController.getWeeklyOrderSummary,
);

router.get(
  "/reports/daily-summary",
  auth,
  authorize("admin", "manager", "dev", "user"),
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
  qcController.editInspectionRecords,
);

router.delete(
  "/:id/inspection-record/:recordId",
  auth,
  authorize("admin"),
  qcController.deleteInspectionRecord,
);

router.get(
  "/:id",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  qcController.getQCById
);

module.exports = router;

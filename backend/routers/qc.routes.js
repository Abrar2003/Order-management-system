const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const qcController = require("../controllers/qc.controller");

// GET all QC
router.get(
  "/list",
  auth,
  authorize("admin", "manager", "QC", "Dev"),
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
  authorize("QC", "admin"),
  qcController.updateQC
);

router.post(
  "/sync-item-details",
  auth,
  authorize("admin", "manager", "dev", "Dev"),
  qcController.syncQcDetailsFromItems,
);

router.get(
  "/daily-report",
  auth,
  authorize("admin", "manager", "QC", "Dev"),
  qcController.getDailyReport
);

router.get(
  "/export",
  auth,
  authorize("admin", "manager", "QC", "Dev"),
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
  authorize("admin", "manager", "QC", "Dev"),
  qcController.getQCById
);

module.exports = router;

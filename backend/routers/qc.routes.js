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

router.get(
  "/:id",
  auth,
  authorize("admin", "manager", "QC", "Dev"),
  qcController.getQCById
);

module.exports = router;

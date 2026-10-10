const express = require("express");
const multer = require("multer");

const auth = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const controller = require("../controllers/eudr.controller");
const inventoryController = require("../controllers/eudrInventory.controller");
const { normalizeUserRoleKey } = require("../helpers/userRole");

const router = express.Router();
const EUDR_ROLE_KEYS = new Set(["admin", "super_admin", "manager"]);
const isEudrRoleAllowed = (role) => EUDR_ROLE_KEYS.has(normalizeUserRoleKey(role));
const requireEudrRole = (req, res, next) => {
  if (!isEudrRoleAllowed(req.user?.role)) {
    return res.status(403).json({ message: "EUDR Timber Management is restricted to admins and managers." });
  }
  return next();
};
const allowedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 20, fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return callback(new Error("Timber documents must be PDF, JPG, JPEG, or PNG files"));
    }
    return callback(null, true);
  },
});

const uploadDocuments = (req, res, next) =>
  documentUpload.array("files", 20)(req, res, (error) => {
    if (!error) return next();
    return res.status(400).json({ success: false, message: error.message || "Invalid timber document upload" });
  });

router.use(auth, requireEudrRole);

router.get("/manufacturers", requirePermission("eudr_timber", "view"), controller.listManufacturers);

router.get("/inventory/reconciliation", requirePermission("eudr_timber", "manage"), inventoryController.getReconciliation);
router.post("/inventory/reconciliation/backfill", requirePermission("eudr_timber", "manage"), inventoryController.backfillApprovedReceipts);
router.get("/inventory/export", requirePermission("eudr_timber", "export"), inventoryController.exportInventory);
router.get("/inventory/:manufacturerId/ledger", requirePermission("eudr_timber", "view"), inventoryController.listInventoryLedger);
router.get("/inventory/:manufacturerId/purchases", requirePermission("eudr_timber", "view"), inventoryController.listInventoryPurchases);
router.get("/inventory/:manufacturerId/consumptions", requirePermission("eudr_timber", "view"), inventoryController.listInventoryConsumptions);
router.get("/inventory/:manufacturerId", requirePermission("eudr_timber", "view"), inventoryController.getInventory);
router.get("/inventory", requirePermission("eudr_timber", "view"), inventoryController.listInventory);

router.get("/container-candidates", requirePermission("eudr_timber", "view"), inventoryController.getContainerCandidates);
router.get("/consumptions", requirePermission("eudr_timber", "view"), inventoryController.listConsumptions);
router.post("/consumptions", requirePermission("eudr_timber", "create"), inventoryController.createConsumption);
router.get("/consumptions/:id", requirePermission("eudr_timber", "view"), inventoryController.getConsumption);
router.patch("/consumptions/:id", requirePermission("eudr_timber", "edit"), inventoryController.updateConsumption);
router.post("/consumptions/:id/confirm", requirePermission("eudr_timber", "approve"), inventoryController.confirmConsumption);
router.post("/consumptions/:id/reverse", requirePermission("eudr_timber", "manage"), inventoryController.reverseConsumption);

router.get("/timber-suppliers", requirePermission("eudr_timber", "view"), controller.listSuppliers);
router.post("/timber-suppliers", requirePermission("eudr_timber", "manage"), controller.createSupplier);
router.get("/timber-suppliers/:id", requirePermission("eudr_timber", "view"), controller.getSupplier);
router.patch("/timber-suppliers/:id", requirePermission("eudr_timber", "manage"), controller.updateSupplier);

router.get("/timber-purchases", requirePermission("eudr_timber", "view"), controller.listPurchases);
router.post("/timber-purchases", requirePermission("eudr_timber", "create"), controller.createPurchase);
router.get("/timber-purchases/:id", requirePermission("eudr_timber", "view"), controller.getPurchase);
router.patch("/timber-purchases/:id", requirePermission("eudr_timber", "edit"), controller.updatePurchase);
router.post("/timber-purchases/:id/submit", requirePermission("eudr_timber", "edit"), controller.submitPurchase);
router.post("/timber-purchases/:id/approve", requirePermission("eudr_timber", "approve"), controller.approvePurchase);
router.post("/timber-purchases/:id/reject", requirePermission("eudr_timber", "approve"), controller.rejectPurchase);
router.post("/timber-purchases/:id/request-info", requirePermission("eudr_timber", "approve"), controller.requestInformation);
router.post("/timber-purchases/:id/reopen", requirePermission("eudr_timber", "manage"), controller.reopenPurchase);
router.post("/timber-purchases/:id/documents", requirePermission("eudr_timber", "upload"), uploadDocuments, controller.uploadDocuments);
router.get("/timber-purchases/:id/documents", requirePermission("eudr_timber", "view"), controller.getPurchaseDocuments);
router.get("/timber-purchases/:id/validation", requirePermission("eudr_timber", "view"), controller.getValidation);
router.post("/timber-purchases/:id/revalidate", requirePermission("eudr_timber", "approve"), controller.revalidatePurchase);
router.get("/documents/:id/download", requirePermission("eudr_timber", "view"), controller.downloadDocument);

module.exports = router;
module.exports.__test__ = { isEudrRoleAllowed };
